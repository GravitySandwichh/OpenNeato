import { createMockApi } from "./shared-api.js";
import { createScenarioState, scenarioCookie, scenarioFromRequest } from "./shared-state.js";

const UMAMI_ENDPOINT = "https://cloud.umami.is/api/send";
const WEBSITE_ID = "417b882b-03c5-45d2-b070-9d7b8b7855d4";

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });

const err = (message, status = 500) => json({ error: message }, status);

async function handleCollect(request) {
    try {
        const form = await request.formData();
        const hostname = new URL(request.url).hostname;

        const response = await fetch(UMAMI_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": request.headers.get("User-Agent") || "Mozilla/5.0",
            },
            body: JSON.stringify({
                type: "event",
                payload: {
                    website: WEBSITE_ID,
                    hostname,
                    ip: request.headers.get("CF-Connecting-IP") || undefined,
                    screen: form.get("s") || "",
                    language: form.get("l") || "",
                    title: form.get("t") || "",
                    url: form.get("u") || "",
                    referrer: form.get("r") || "",
                },
            }),
        });

        return new Response(null, { status: response.ok ? 204 : 502 });
    } catch (error) {
        console.error("[Analytics]", error);
        return new Response(null, { status: 502 });
    }
}

const createDefaultHistory = () => {
    const now = Math.floor(Date.now() / 1000);
    const house = `${now - 7200}`;
    const spot = `${now - 3600}`;

    return new Map([
        [
            `${house}.jsonl.hs`,
            [
                `{"type":"session","time":${house},"mode":"house","battery":95}`,
                '{"x":0.0,"y":0.0,"t":0.0,"ts":0.0}',
                '{"x":0.5,"y":0.2,"t":15.0,"ts":4.0}',
                '{"x":1.2,"y":0.8,"t":45.0,"ts":10.0}',
                '{"type":"summary","duration":1800,"distanceTraveled":34.5,"areaCovered":26.2,"batteryEnd":62}',
            ],
        ],
        [
            `${spot}.jsonl.hs`,
            [
                `{"type":"session","time":${spot},"mode":"spot","battery":80}`,
                '{"x":0.0,"y":0.0,"t":0.0,"ts":0.0}',
                '{"x":0.3,"y":0.3,"t":45.0,"ts":2.0}',
                '{"type":"summary","duration":420,"distanceTraveled":8.4,"areaCovered":4.1,"batteryEnd":71}',
            ],
        ],
    ]);
};

let initializedScenario = null;
let bootTime = Date.now();

const context = {
    state: {},
    faults: {},
    historySessions: new Map(),
    rand: randomInt,
    sleep,
    getVersion: () => "0.0",
    getBootTime: () => bootTime,
    reboot: () => {
        bootTime = Date.now();
    },
};

const api = createMockApi(context);

function initScenario(rawScenario) {
    const scenario = rawScenario.trim() || "ok";
    const scenarioState = createScenarioState(scenario);
    context.state = scenarioState.state;
    context.faults = scenarioState.faults;
    context.historySessions = createDefaultHistory();
    bootTime = Date.now();
    initializedScenario = scenario;
}

const toWorkerResponse = (response) => {
    if (response === false) return err("not found", 404);
    if (response.offline) return err("Device unreachable", 503);
    return new Response(response.body ?? "", {
        status: response.status,
        headers: response.headers,
    });
};

async function handleApi(request, env) {
    const url = new URL(request.url);
    const scenario = scenarioFromRequest(url.searchParams, request.headers.get("Cookie") ?? "");
    if (scenario !== initializedScenario) initScenario(scenario);

    await sleep(randomInt(50, 200));

    const demoMode = (env.DEMO_MODE ?? "true").toLowerCase() === "true";

    if (demoMode && request.method === "POST" && url.pathname === "/api/firmware/update") {
        return err("Firmware upload is disabled in demo mode", 403);
    }
    if (demoMode && request.method === "POST" && url.pathname === "/api/history/import") {
        return err("Session import is disabled in demo mode", 403);
    }

    let cachedBytes = null;
    const bytes = async () => {
        cachedBytes ??= new Uint8Array(await request.arrayBuffer());
        return cachedBytes;
    };

    const response = toWorkerResponse(
        await api.handle({
            method: request.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            bytes,
            text: async () => new TextDecoder().decode(await bytes()),
        }),
    );
    if (url.searchParams.has("scenario")) response.headers.set("Set-Cookie", scenarioCookie(scenario));
    return response;
}

async function serveAsset(request, env) {
    const url = new URL(request.url);
    const scenario = url.searchParams.get("scenario");
    const rawAssetResponse = await env.ASSETS.fetch(request);
    const assetResponse = new Response(rawAssetResponse.body, rawAssetResponse);
    if (scenario) assetResponse.headers.set("Set-Cookie", scenarioCookie(scenario));
    if (assetResponse.status !== 404) return assetResponse;

    const indexRequest = new Request(new URL("/index.html", url).toString(), request);
    const rawIndexResponse = await env.ASSETS.fetch(indexRequest);
    const indexResponse = new Response(rawIndexResponse.body, rawIndexResponse);
    if (scenario) indexResponse.headers.set("Set-Cookie", scenarioCookie(scenario));
    if (indexResponse.status !== 404) return indexResponse;
    return assetResponse;
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method === "POST" && url.pathname === "/api/collect") return handleCollect(request);
        if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/repos/")) return handleApi(request, env);
        return serveAsset(request, env);
    },
};
