/**
 * シード付き乱数（xorshift32）
 */
function makeRng(seed) {
    let s = seed >>> 0;
    return function next() {
        // xorshift32
        s ^= s << 13;
        s >>>= 0;
        s ^= s >> 17;
        s >>>= 0;
        s ^= s << 5;
        s >>>= 0;
        // 0 <= x < 1
        return s / 0x100000000;
    };
}
/**
 * Fisher-Yatesシャッフル
 */
function shuffleInPlace(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = (rnd() * (i + 1)) | 0;
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
}
/**
 * レベルに応じてスート構成を決め、
 * Spider用の104枚デッキを作る。
 *
 * - レベル1: ["S"] を8セット (8*13=104)
 * - レベル2: ["S","H"] を4セットずつ (2*4*13=104)
 * - レベル3: ["S","H","D","C"] を2セットずつ (4*2*13=104)
 */
function buildSpiderDeck(level) {
    let suits;
    if (level <= 1) {
        suits = ["S"];
    }
    else if (level === 2) {
        suits = ["S", "H"];
    }
    else {
        suits = ["S", "H", "D", "C"];
    }
    // 104枚に揃うような複製回数
    // 例:
    //  suits=1本 -> copiesPerSuit=8
    //  suits=2本 -> copiesPerSuit=4
    //  suits=4本 -> copiesPerSuit=2
    const copiesPerSuit = Math.floor(104 / (13 * suits.length));
    const deck = [];
    for (const suit of suits) {
        for (let copy = 0; copy < copiesPerSuit; copy++) {
            // ランクは1(A)～13(K)のどっちの順番でも良いが
            // シャッフルするのでどちらでも同じでございます
            for (let rank = 1; rank <= 13; rank++) {
                deck.push({
                    rank,
                    suit,
                    faceUp: false,
                });
            }
        }
    }
    return deck;
}
/**
 * スパイダー初期状態を生成する
 *
 * - 10列タブロー
 *   列0～3: 6枚
 *   列4～9: 5枚
 *   各列の一番上だけ faceUp=true
 * - 残りは stock（裏のまま）
 */
export function dealSpiderGame(seed, level) {
    const rnd = makeRng(seed);
    const deck = buildSpiderDeck(level);
    shuffleInPlace(deck, rnd);
    // タブロー10列
    const columns = Array.from({ length: 10 }, () => []);
    for (let colIndex = 0; colIndex < 10; colIndex++) {
        const need = colIndex < 4 ? 6 : 5;
        for (let j = 0; j < need; j++) {
            const card = deck.pop();
            if (!card)
                throw new Error("Spider配布中にデッキが尽きました");
            // 最後に積んだカードだけ表にする
            if (j === need - 1) {
                card.faceUp = true;
            }
            columns[colIndex].push(card);
        }
    }
    // 残りが山札
    const stock = deck; // 50枚想定
    // 初期は完成済みセット0
    return {
        columns,
        stock,
        completedStacks: 0,
    };
}
