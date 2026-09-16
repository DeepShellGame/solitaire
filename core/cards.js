// スートから色
function suitToColor(suit) {
    return suit === "H" || suit === "D" ? "red" : "black";
}
/**
 * 通常の52枚デッキを作る
 * rankは1(A)～13(K)
 * idは "H7#0" のような形式
 */
export function buildStandardDeck() {
    const suits = ["H", "D", "C", "S"];
    const cards = [];
    for (const suit of suits) {
        for (let rank = 1; rank <= 13; rank++) {
            cards.push({
                id: `${suit}${rank}#0`,
                suit,
                rank,
                color: suitToColor(suit)
            });
        }
    }
    return cards;
}
