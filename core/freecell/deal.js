// core/freecell/deal.ts
import { PRNG } from "../prng.js";
import { buildStandardDeck } from "../cards.js";
// レベルごとのフリーセル数だけここで決める
// レベル1: フリーセル4つ + 特殊配列（上3枚はA〜10）
// レベル2: フリーセル4つ + 通常配り
// レベル3: フリーセル3つ + 通常配り
export function getFreeCellLevelConfig(level) {
    switch (level) {
        case 1:
            return { freecellSlots: 4 };
        case 2:
            return { freecellSlots: 4 };
        case 3:
            return { freecellSlots: 3 };
        default:
            return { freecellSlots: 4 };
    }
}
// 通常のフリーセル配り（シャッフル済みデッキを8列にラウンドロビン配布）
function dealStandardFromShuffledDeck(deckShuffled, freecellSlots) {
    const columns = Array.from({ length: 8 }, () => []);
    for (let i = 0; i < deckShuffled.length; i++) {
        columns[i % 8].push(deckShuffled[i]);
    }
    const freecells = Array.from({ length: freecellSlots }, () => null);
    // foundations: [H, D, C, S] の順で空
    const foundations = [[], [], [], []];
    return {
        columns,
        freecells,
        foundations
    };
}
// レベル1専用：
// 各列の「一番上から3枚」は必ず rank<=10 (A〜10) の札になるように並べる
function dealLevel1Special(prng, deckShuffled, freecellSlots) {
    // deckShuffled から low(A〜10) / high(J,Q,K) に分割
    const lowAll = deckShuffled.filter((c) => c.rank <= 10);
    const highAll = deckShuffled.filter((c) => c.rank >= 11);
    // フェイルセーフ（普通は必ず通る）
    // 各列3枚×8列=24枚は低ランクが必要
    // あと残りで下側を埋める
    if (lowAll.length < 24 || highAll.length < 12) {
        // 想定外なら通常配りにフォールバック
        return dealStandardFromShuffledDeck(deckShuffled, freecellSlots);
    }
    // low / high を個別にシャッフル
    const lowPool = lowAll.slice();
    const highPool = highAll.slice();
    prng.shuffleInPlace(lowPool);
    prng.shuffleInPlace(highPool);
    // 各列のトップ3枚分を lowPool から確保
    // topForCols[i] は列iの最上段3枚
    const topForCols = [];
    for (let i = 0; i < 8; i++) {
        topForCols.push(lowPool.splice(0, 3));
    }
    // 残り (lowPool + highPool) をまとめてシャッフル
    let restPool = lowPool.concat(highPool);
    prng.shuffleInPlace(restPool);
    // 列を組む
    // フリーセル標準:
    //   前半4列(0〜3)は7枚
    //   後半4列(4〜7)は6枚
    // そのうち上3枚は上で確保済み(topForCols)
    // 残り(7-3=4 or 6-3=3)は restPool から敷く
    const columns = Array.from({ length: 8 }, () => []);
    for (let colIdx = 0; colIdx < 8; colIdx++) {
        const targetCount = colIdx < 4 ? 7 : 6;
        const needUnder = Math.max(0, targetCount - 3);
        // restPoolが万一足りない場合の保険
        if (restPool.length < needUnder) {
            const need = needUnder - restPool.length;
            // deckShuffled から適当に補充（ここに入ることは普通ない）
            restPool = restPool.concat(deckShuffled.slice(0, need));
        }
        const underCards = restPool.splice(0, needUnder);
        columns[colIdx] = underCards.concat(topForCols[colIdx]);
    }
    // freecells
    const freecells = Array.from({ length: freecellSlots }, () => null);
    // foundations初期化 [H,D,C,S]
    const foundations = [[], [], [], []];
    return {
        columns,
        freecells,
        foundations
    };
}
// 公開API: seedとlevelから初期状態を作る
export function dealFreeCellInitialState(seed, level) {
    const prng = new PRNG(seed >>> 0);
    const deck = buildStandardDeck();
    prng.shuffleInPlace(deck); // まず全体をシャッフル
    const { freecellSlots } = getFreeCellLevelConfig(level);
    if (level === 1) {
        // レベル1は特殊配列
        return dealLevel1Special(prng, deck, freecellSlots);
    }
    // レベル2以降は標準配り
    return dealStandardFromShuffledDeck(deck, freecellSlots);
}
