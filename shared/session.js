// shared/session.ts
import * as freecellDeal from "../core/freecell/deal.js";
import * as klondikeDeal from "../core/klondike/deal.js";
import * as spiderDeal from "../core/spider/deal.js";
import { getDealVersion } from "./dealVersion.js";
/**
 * deal/freecell 側の初期化関数を推定して返す
 * 必ず (seed:number, level:number) => FreeCellState
 */
function resolveFreecellInitFn(mod) {
    const candidates = [
        "dealFreeCellGame",
        "dealFreecellGame",
        "dealFreeCellInitialState",
        "dealFreecellInitialState",
        "initFreeCellGame",
        "initFreecellGame",
        "initFreecell",
        "dealFreeCell",
        "dealFreecell",
    ];
    for (const name of candidates) {
        if (typeof mod[name] === "function") {
            return mod[name];
        }
    }
    throw new Error("freecellの初期化関数が見つかりませんでした。deal/freecell側のexport名をご確認ください。");
}
/**
 * deal/klondike 側の初期化関数を推定して返す
 * 必ず (seed:number, level:number) => KlondikeState
 */
function resolveKlondikeInitFn(mod) {
    const candidates = [
        "dealKlondikeGame",
        "dealKlondikeInitialState",
        "initKlondikeGame",
        "initKlondike",
        "dealKlondike",
    ];
    for (const name of candidates) {
        if (typeof mod[name] === "function") {
            return mod[name];
        }
    }
    throw new Error("klondikeの初期化関数が見つかりませんでした。deal/klondike側のexport名をご確認ください。");
}
/**
 * deal/spider 側の初期化関数を推定して返す
 * 必ず (seed:number, level:number) => SpiderState
 */
function resolveSpiderInitFn(mod) {
    const candidates = [
        "dealSpiderGame",
        "initSpiderGame",
        "dealSpiderInitialState",
        "initSpider",
    ];
    for (const name of candidates) {
        if (typeof mod[name] === "function") {
            return mod[name];
        }
    }
    throw new Error("spiderの初期化関数が見つかりませんでした。deal/spider側のexport名をご確認ください。");
}
export class GameSession {
    mode; // "freecell" | "klondike" | "spider"
    level; // レベル
    seed; // 乱数シード
    dealVersion; // 盤面生成互換バージョン
    turnIndex; // 現在の有効手数（UNDOで戻る）
    state; // 盤面
    undoStack;
    moveLog;
    startedAtMs;
    constructor(mode, level, seed) {
        this.mode = mode;
        this.level = level;
        this.seed = seed >>> 0;
        this.dealVersion = getDealVersion(mode);
        this.turnIndex = 0;
        this.startedAtMs = Date.now();
        if (mode === "freecell") {
            const initFn = resolveFreecellInitFn(freecellDeal);
            this.state = initFn(this.seed, level);
        }
        else if (mode === "klondike") {
            const initFn = resolveKlondikeInitFn(klondikeDeal);
            this.state = initFn(this.seed, level);
        }
        else if (mode === "spider") {
            const initFn = resolveSpiderInitFn(spiderDeal);
            this.state = initFn(this.seed, level);
        }
        else {
            throw new Error("未実装モード: " + mode);
        }
        this.undoStack = [];
        this.moveLog = [];
    }
    /**
     * 盤面コピーを取ってUNDOスタックに積む
     * main.ts 側では「実際に動かす前」に呼んでいる
     */
    snapshot() {
        const clonedState = JSON.parse(JSON.stringify(this.state));
        this.undoStack.push({
            state: clonedState,
            turnIndex: this.turnIndex,
            moveLogLength: this.moveLog.length,
        });
    }
    /**
     * 1手戻す
     */
    undo() {
        const last = this.undoStack.pop();
        if (!last) {
            return false;
        }
        this.state = last.state;
        this.turnIndex = last.turnIndex;
        this.moveLog.length = last.moveLogLength;
        return true;
    }
    /**
     * applyMove側から渡されたログを保持
     */
    recordMove(entry) {
        if (entry === undefined || entry === null)
            return;
        // 各ゲームのログ形式は当面そのまま許容しつつ、index が無いログには付与する。
        if (typeof entry === "object" && entry !== null && entry.index === undefined) {
            entry.index = this.turnIndex;
        }
        this.moveLog.push(entry);
        this.turnIndex += 1;
    }
    /**
     * クリア時のレポート
     */
    buildClearReport(finalized) {
        return {
            mode: this.mode,
            level: this.level,
            seed: this.seed >>> 0,
            dealVersion: this.dealVersion,
            finalized,
            moveCount: this.moveLog.length,
            durationMs: Math.max(0, Date.now() - this.startedAtMs),
            moves: this.moveLog.slice(),
            finalState: JSON.parse(JSON.stringify(this.state)),
            timestamp: Date.now(),
        };
    }
}
