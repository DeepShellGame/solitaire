// V1 は旧公開版の形式。V2 では dealVersion を追加する。
// V1: V1,ts_ms,modeId,level,seed,moves,dur_ms
// V2: V2,ts_ms,modeId,level,seed,dealVersion,moves,dur_ms
const CLEAR_LOG_KEY = "ClearSeedLogV2";
const LEGACY_CLEAR_LOG_KEY = "ClearSeedLogV1";
const CLEAR_LOG_MAX_BYTES = 4_500_000;
let clearLogMigrationChecked = false;
function modeToId(mode) {
    return mode === "freecell" ? 0 : mode === "klondike" ? 1 : 2;
}
function idToMode(modeId) {
    return modeId === 0 ? "freecell" : modeId === 1 ? "klondike" : "spider";
}
function identityOfStored(rec) {
    return `${rec.modeId}|${rec.level}|${rec.seed >>> 0}|${rec.dealVersion}`;
}
export function clearSeedIdentity(rec) {
    return `${modeToId(rec.mode)}|${rec.level}|${rec.seed >>> 0}|${rec.dealVersion}`;
}
function parseStoredLine(line) {
    const p = line.trim().split(",");
    if (p[0] === "V1" && p.length >= 7) {
        const [tsMs, modeId, level, seed, moves, durMs] = p.slice(1, 7).map(Number);
        if (![tsMs, modeId, level, seed, moves, durMs].every(Number.isFinite))
            return null;
        if (modeId < 0 || modeId > 2)
            return null;
        return {
            tsMs,
            modeId: modeId,
            level,
            seed: seed >>> 0,
            dealVersion: 1,
            moves,
            durMs,
        };
    }
    if (p[0] === "V2" && p.length >= 8) {
        const [tsMs, modeId, level, seed, dealVersion, moves, durMs] = p.slice(1, 8).map(Number);
        if (![tsMs, modeId, level, seed, dealVersion, moves, durMs].every(Number.isFinite))
            return null;
        if (modeId < 0 || modeId > 2)
            return null;
        return {
            tsMs,
            modeId: modeId,
            level,
            seed: seed >>> 0,
            dealVersion,
            moves,
            durMs,
        };
    }
    return null;
}
function formatStoredV2(rec) {
    return [
        "V2",
        rec.tsMs,
        rec.modeId,
        rec.level | 0,
        rec.seed >>> 0,
        rec.dealVersion | 0,
        rec.moves | 0,
        rec.durMs | 0,
    ].join(",");
}
function migrateLegacyClearLogIfNeeded() {
    if (clearLogMigrationChecked)
        return;
    clearLogMigrationChecked = true;
    try {
        const current = localStorage.getItem(CLEAR_LOG_KEY) || "";
        const legacy = localStorage.getItem(LEGACY_CLEAR_LOG_KEY) || "";
        if (!legacy.trim())
            return;
        const byId = new Map();
        for (const line of `${current}\n${legacy}`.split("\n")) {
            const rec = parseStoredLine(line);
            if (!rec)
                continue;
            const id = identityOfStored(rec);
            const prev = byId.get(id);
            if (!prev || rec.tsMs > prev.tsMs)
                byId.set(id, rec);
        }
        const merged = Array.from(byId.values())
            .sort((a, b) => a.tsMs - b.tsMs)
            .map(formatStoredV2);
        if (merged.length) {
            localStorage.setItem(CLEAR_LOG_KEY, merged.join("\n") + "\n");
            localStorage.removeItem(LEGACY_CLEAR_LOG_KEY);
        }
    }
    catch {
        // localStorage が使えない環境では何もしない。
    }
}
function readRaw() {
    try {
        migrateLegacyClearLogIfNeeded();
        return localStorage.getItem(CLEAR_LOG_KEY) || "";
    }
    catch {
        return "";
    }
}
function writeRaw(value) {
    try {
        localStorage.setItem(CLEAR_LOG_KEY, value);
        return true;
    }
    catch {
        return false;
    }
}
function pruneIfNeeded() {
    const raw = readRaw();
    if (raw.length <= CLEAR_LOG_MAX_BYTES)
        return;
    const lines = raw.split("\n").filter(Boolean);
    const newerHalf = lines.slice(Math.floor(lines.length / 2)).join("\n");
    writeRaw(newerHalf ? newerHalf + "\n" : "");
}
function toStored(rec) {
    return {
        tsMs: rec.tsMs,
        modeId: modeToId(rec.mode),
        level: rec.level,
        seed: rec.seed >>> 0,
        dealVersion: rec.dealVersion,
        moves: rec.moves,
        durMs: rec.durMs,
    };
}
function fromStored(rec) {
    return {
        tsMs: rec.tsMs,
        mode: idToMode(rec.modeId),
        level: rec.level,
        seed: rec.seed >>> 0,
        dealVersion: rec.dealVersion,
        moves: rec.moves,
        durMs: rec.durMs,
    };
}
/**
 * 未送信のクリア済みシードを追加する。
 * 同じ game + level + seed + dealVersion は1件だけ保持する。
 */
export function enqueueClearedSeed(rec) {
    const stored = toStored(rec);
    const id = identityOfStored(stored);
    const raw = readRaw();
    for (const line of raw.split("\n")) {
        const existing = parseStoredLine(line);
        if (existing && identityOfStored(existing) === id)
            return "duplicate";
    }
    const newLine = formatStoredV2(stored);
    const base = raw && !raw.endsWith("\n") ? raw + "\n" : raw;
    if (writeRaw(base + newLine + "\n")) {
        pruneIfNeeded();
        return "added";
    }
    // 容量上限で書けなかった場合は、古い半分を落として「今回のクリア」を優先して再試行。
    const oldLines = raw.split("\n").filter(Boolean);
    const newerHalf = oldLines.slice(Math.floor(oldLines.length / 2));
    const retryRaw = [...newerHalf, newLine].join("\n") + "\n";
    return writeRaw(retryRaw) ? "added" : "storage-error";
}
/** サーバーへ送る対象。古い順で返す。 */
export function listPendingClearedSeeds() {
    const byId = new Map();
    for (const line of readRaw().split("\n")) {
        const rec = parseStoredLine(line);
        if (!rec)
            continue;
        const id = identityOfStored(rec);
        const prev = byId.get(id);
        if (!prev || rec.tsMs > prev.tsMs)
            byId.set(id, rec);
    }
    return Array.from(byId.values())
        .sort((a, b) => a.tsMs - b.tsMs)
        .map(fromStored);
}
/**
 * サーバー登録に成功したIDだけローカル保留キューから削除する。
 * 返り値は削除件数。
 */
export function removePendingClearedSeeds(identities) {
    const targets = new Set(identities);
    if (!targets.size)
        return 0;
    const kept = [];
    let removed = 0;
    for (const line of readRaw().split("\n")) {
        const rec = parseStoredLine(line);
        if (!rec)
            continue;
        if (targets.has(identityOfStored(rec))) {
            removed++;
        }
        else {
            kept.push(formatStoredV2(rec));
        }
    }
    writeRaw(kept.length ? kept.join("\n") + "\n" : "");
    return removed;
}
function normalizeImportRecord(value) {
    if (!value || typeof value !== "object")
        return null;
    const v = value;
    const mode = v.mode;
    const level = Number(v.level);
    const seed = Number(v.seed);
    const dealVersion = Number(v.dealVersion ?? 1);
    const tsMs = Number(v.tsMs ?? Date.now());
    const moves = Number(v.moves ?? 0);
    const durMs = Number(v.durMs ?? 0);
    if (mode !== "freecell" && mode !== "klondike" && mode !== "spider")
        return null;
    if (!Number.isInteger(level) || level < 1 || level > 3)
        return null;
    if (!Number.isFinite(seed) || seed < 0 || seed > 0xffffffff)
        return null;
    if (!Number.isInteger(dealVersion) || dealVersion < 1)
        return null;
    if (![tsMs, moves, durMs].every(Number.isFinite))
        return null;
    return {
        tsMs: Math.max(0, Math.trunc(tsMs)),
        mode,
        level,
        seed: seed >>> 0,
        dealVersion,
        moves: Math.max(0, Math.trunc(moves)),
        durMs: Math.max(0, Math.trunc(durMs)),
    };
}
/**
 * GitHub Pages のアカウント/ドメイン移行用バックアップ。
 * 書き出しても端末内の未送信seedは削除しない。
 */
export function exportClearedSeedBackupText() {
    const records = listPendingClearedSeeds();
    const backup = {
        format: "solitaire-clear-seeds",
        version: 1,
        exportedAt: new Date().toISOString(),
        recordCount: records.length,
        records,
    };
    return JSON.stringify(backup, null, 2) + "\n";
}
/**
 * 新しいGitHub Pages側へバックアップを取り込む。
 * JSONバックアップのほか、旧V1/V2の生ログ貼り付け/テキストも受け付ける。
 */
export function importClearedSeedBackupText(text) {
    const result = { total: 0, added: 0, duplicates: 0, invalid: 0 };
    const trimmed = text.trim();
    if (!trimmed)
        return result;
    let candidates = null;
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            candidates = parsed;
        }
        else if (parsed && typeof parsed === "object") {
            const obj = parsed;
            if (obj.format === "solitaire-clear-seeds" && Number(obj.version) === 1 && Array.isArray(obj.records)) {
                candidates = obj.records;
            }
        }
    }
    catch {
        // JSONでなければ旧V1/V2の行形式として下で処理する。
    }
    if (candidates) {
        for (const value of candidates) {
            result.total++;
            const rec = normalizeImportRecord(value);
            if (!rec) {
                result.invalid++;
                continue;
            }
            const added = enqueueClearedSeed(rec);
            if (added === "added")
                result.added++;
            else if (added === "duplicate")
                result.duplicates++;
            else
                result.invalid++;
        }
        return result;
    }
    for (const line of trimmed.split(/\r?\n/)) {
        if (!line.trim())
            continue;
        result.total++;
        const stored = parseStoredLine(line);
        if (!stored) {
            result.invalid++;
            continue;
        }
        const added = enqueueClearedSeed(fromStored(stored));
        if (added === "added")
            result.added++;
        else if (added === "duplicate")
            result.duplicates++;
        else
            result.invalid++;
    }
    return result;
}
