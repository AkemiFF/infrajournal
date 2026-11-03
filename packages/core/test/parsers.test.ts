import { describe, expect, it } from "vitest";
import { parseCompose } from "../src/parsers/compose.js";
import { parseNginx } from "../src/parsers/nginx.js";
import { parseCaddy } from "../src/parsers/caddy.js";

const compose = (text: string) => parseCompose(text, "demo", "compose.yml");
const codes = (result: { issues: Array<{ definition: { code: string } }> }) =>
  result.issues.map((item) => item.definition.code);

describe("Compose subset", () => {
  it("models networks, volumes, bind mounts, both port forms, dependencies, health and key names", () => {
    const result = compose(`name: demo
services:
  api:
    build: {context: ., dockerfile: Dockerfile.api}
    networks: [frontend, backend]
    volumes: [data:/var/lib/data, './src:/app:ro']
    ports:
      - '127.0.0.1:8080:80/tcp'
      - {target: 9000, published: 9001, protocol: udp}
    depends_on: {db: {condition: service_healthy}}
    healthcheck: {test: ['CMD', 'true']}
    environment: {DATABASE_URL: 'postgres://secret:password@db/x', MODE: dev}
    env_file: [{path: .env.local, required: false}]
    labels: {owner: 'secret-label-value'}
  db: {image: postgres:16, networks: [backend]}
networks:
  frontend: {driver: bridge}
  backend: {}
volumes:
  data: {labels: {infrajournal.backup: nightly}}
`);
    const api = result.services[0]!;
    expect(api.build).toEqual({ context: ".", dockerfile: "Dockerfile.api" });
    expect(api.networkNames).toEqual(["frontend", "backend"]);
    expect(api.mounts.map((mount) => [mount.type, mount.source, mount.readOnly])).toEqual([
      ["named", "data", false],
      ["bind", "./src", true],
    ]);
    expect(api.ports.map(({ source: _source, ...port }) => port)).toEqual([
      { hostIp: "127.0.0.1", published: "8080", target: "80", protocol: "tcp" },
      { published: "9001", target: "9000", protocol: "udp" },
    ]);
    expect(api.dependsOnNames).toEqual(["db"]);
    expect(api.healthcheck).toBe(true);
    expect(api.environmentKeys).toEqual(["DATABASE_URL", "MODE"]);
    expect(api.envFiles).toEqual([".env.local"]);
    expect(api.labelKeys).toEqual(["owner"]);
    expect(result.networks.map((network) => network.name)).toEqual(["frontend", "backend"]);
    expect(result.volumes[0]?.backupLabel).toBe("nightly");
    expect(codes(result)).toContain("IJ031");
  });

  it("reports malformed YAML and a missing services mapping without inventing services", () => {
    expect(codes(compose("services: [oops"))).toContain("IJ001");
    const missing = compose("networks: {front: {}}\n");
    expect(missing.services).toEqual([]);
    expect(codes(missing)).toContain("IJ002");
  });

  it("reports unresolved interpolation and unsupported constructs without evaluating them", () => {
    const result = compose(`version: '3'
include: [other.yml]
secrets: {private: {file: ./secret}}
services:
  api:
    image: 'api:${"${TAG}"}'
    network_mode: host
    extends: {file: other.yml, service: base}
    secrets: [private]
  empty: {environment: ['PASSWORD=example-password']}
`);
    expect(codes(result)).toEqual(
      expect.arrayContaining(["IJ003", "IJ026", "IJ027", "IJ028", "IJ029", "IJ041", "IJ002"]),
    );
    expect(result.services[1]?.image).toBeUndefined();
  });
});

describe("Nginx subset", () => {
  it("models server_name aliases, TLS, locations and upstream server targets", () => {
    const parsed = parseNginx(`http {
  upstream app_pool { server api:3000; server worker:3001; }
  server {
    listen 443 ssl;
    server_name app.example.test www.example.test;
    location /api { proxy_pass http://app_pool; }
  }
}`);
    expect(parsed.servers).toHaveLength(1);
    expect(parsed.servers[0]).toMatchObject({
      serverNames: ["app.example.test", "www.example.test"],
      listens: ["443"],
      tls: true,
    });
    expect(parsed.servers[0]?.routes.map(({ path, upstream }) => [path, upstream])).toEqual([
      ["/api", "api:3000"],
      ["/api", "worker:3001"],
    ]);
  });

  it("warns for include, map, regex locations, variable upstreams, and broken braces", () => {
    const parsed = parseNginx(`http { include secret.conf; map $host $backend { default api; }
server { server_name app.test; location ~ \\.php$ { proxy_pass http://api:80; }
location /dynamic { proxy_pass http://$backend; }
`);
    expect(codes(parsed)).toEqual(expect.arrayContaining(["IJ010", "IJ012", "IJ014", "IJ015"]));
    expect(parsed.servers[0]?.routes).toEqual(
      expect.arrayContaining([expect.objectContaining({ upstream: "api:80" })]),
    );
    expect(parsed.servers[0]?.routes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ upstream: "$backend" })]),
    );
  });
});

describe("Caddy subset", () => {
  it("models multiple addresses, path matchers, handle_path and block `to` targets", () => {
    const parsed = parseCaddy(`app.test, http://plain.test {
  reverse_proxy /api/* api:3000
  handle_path /admin/* { reverse_proxy { to admin:4000 } }
}`);
    expect(parsed.sites.map((site) => [site.addresses[0], site.tls])).toEqual([
      ["app.test", true],
      ["plain.test", false],
    ]);
    for (const site of parsed.sites) {
      expect(site.routes.map(({ path, upstream }) => [path, upstream])).toEqual([
        ["/admin/*", "admin:4000"],
        ["/api/*", "api:3000"],
      ]);
    }
  });

  it("warns for placeholders, imports and unclosed blocks", () => {
    const parsed = parseCaddy(`app.test {
import private.conf
reverse_proxy {env.TARGET}
`);
    expect(codes(parsed)).toEqual(expect.arrayContaining(["IJ011", "IJ014", "IJ015"]));
    expect(parsed.sites[0]?.routes).toEqual([]);
  });
});
