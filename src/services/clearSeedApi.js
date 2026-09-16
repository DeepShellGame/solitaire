import { CLEAR_SEED_API_URL } from "../config.js";
import { clearSeedIdentity, listPendingClearedSeeds, removePendingClearedSeeds, } from "./clearSeedStore.js";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BATCH_SIZE = 200;
async function fetchJson(path, init) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        const res = await fetch(`${CLEAR_SEED_API_URL}${path}`, {
            ...init,
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                ...(init?.headers || {}),
            },
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            const msg = body?.error || `HTTP ${res.status}`;
            throw new Error(msg);
        }
        return body;
    }
    finally {
        window.clearTimeout(timer);
    }
}
/**
 * ローカル未送信キューをサーバーへ送る。
 * サーバー側に既に存在していたseedも「登録済み」とみなし、ローカルから削除する。
 */
export async function flushPendingClearedSeeds() {
    let sent = 0;
    let removed = 0;
    while (true) {
        const pending = listPendingClearedSeeds();
        if (!pending.length)
            break;
        const batch = pending.slice(0, MAX_BATCH_SIZE);
        const body = await fetchJson("/api/clear-seeds/batch", {
            method: "POST",
            body: JSON.stringify({ records: batch }),
        });
        const accepted = Array.isArray(body?.acceptedIdentities)
            ? body.acceptedIdentities.filter((v) => typeof v === "string")
            : [];
        if (!accepted.length) {
            throw new Error("サーバーが登録済みseedを返しませんでした");
        }
        sent += batch.length;
        const removedThisBatch = removePendingClearedSeeds(accepted);
        removed += removedThisBatch;
        // 正常応答なのに1件もローカルから減らない場合は無限ループを防止。
        if (removedThisBatch === 0 && listPendingClearedSeeds().length >= pending.length) {
            throw new Error("クリアseed同期が進みませんでした");
        }
    }
    return {
        sent,
        removed,
        remaining: listPendingClearedSeeds().length,
    };
}
/** game + level + dealVersion に一致する、実際にクリア済みのseedを1件取得する。 */
export async function fetchGuaranteedSeed(mode, level, dealVersion) {
    const q = new URLSearchParams({
        mode,
        level: String(level | 0),
        dealVersion: String(dealVersion | 0),
    });
    const body = await fetchJson(`/api/clear-seeds/random?${q.toString()}`, {
        method: "GET",
    });
    if (body?.seed === null || body?.seed === undefined)
        return null;
    const seed = Number(body.seed);
    const count = Number(body.count || 0);
    if (!Number.isFinite(seed))
        throw new Error("不正なseed応答です");
    return {
        seed: seed >>> 0,
        count: Number.isFinite(count) ? count | 0 : 0,
    };
}
export function pendingClearSeedCount() {
    return listPendingClearedSeeds().length;
}
export function identityForRecord(rec) {
    return clearSeedIdentity(rec);
}
