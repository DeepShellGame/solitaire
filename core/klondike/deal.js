// core/klondike/deal.ts
// 乱数（seed固定で再現可能）
function makeRng(seed) {
    // mulberry32系
    let t = seed >>> 0;
    return function () {
        t += 0x6D2B79F5;
        let x = t;
        x = Math.imul(x ^ (x >>> 15), x | 1);
        x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}
function shuffleInPlace(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = (rng() * (i + 1)) | 0;
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
}
function makeDeck() {
    const suits = ["H", "D", "C", "S"];
    const deck = [];
    for (const s of suits) {
        for (let r = 1; r <= 13; r++) {
            deck.push({
                rank: r,
                suit: s,
                faceUp: false
            });
        }
    }
    return deck;
}
// レベル別ルール：
// level1: drawCount=1, tableau列の下2枚を表に
// level2: drawCount=1, tableau列の一番下だけ表
// level3: drawCount=3, tableau列の一番下だけ表
export function dealKlondikeInitialState(seed, level) {
    const rng = makeRng(seed);
    const deck = makeDeck();
    shuffleInPlace(deck, rng);
    // 7列に 1,2,3,4,5,6,7 枚配る
    const tableaus = [];
    for (let col = 0; col < 7; col++) {
        const need = col + 1;
        const colCards = [];
        for (let i = 0; i < need; i++) {
            const card = deck.pop();
            if (!card)
                break;
            // いったん全部裏にして入れる
            colCards.push({
                rank: card.rank,
                suit: card.suit,
                faceUp: false
            });
        }
        tableaus.push(colCards);
    }
    // 裏→表のひっくり返しルール
    for (let col = 0; col < tableaus.length; col++) {
        const colCards = tableaus[col];
        const len = colCards.length;
        if (!len)
            continue;
        // 常に一番下は表
        colCards[len - 1].faceUp = true;
        // level1だけ、その1つ上も表にする（下2枚オープン）
        if (level === 1 && len >= 2) {
            colCards[len - 2].faceUp = true;
        }
    }
    const drawCount = (level >= 3) ? 3 : 1;
    // 残りは山札（全部裏）
    const stock = deck.map(c => ({
        rank: c.rank,
        suit: c.suit,
        faceUp: false
    }));
    return {
        stock,
        waste: [],
        foundations: [[], [], [], []], // H,D,C,S の順
        tableaus,
        drawCount
    };
}
