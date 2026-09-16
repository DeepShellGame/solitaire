export function rankToLabel(rank) {
    if (rank === 1)
        return "A";
    if (rank === 11)
        return "J";
    if (rank === 12)
        return "Q";
    if (rank === 13)
        return "K";
    return String(rank);
}
export function suitGlyph(suit) {
    switch (suit) {
        case "H": return "♥";
        case "D": return "♦";
        case "C": return "♣";
        case "S": return "♠";
    }
    return "";
}
export function suitColor(suit) {
    return suit === "H" || suit === "D" ? "red" : "black";
}
// 「♠A」などの左上表記テキスト
export function headerText(suit, rank) {
    return suitGlyph(suit) + rankToLabel(rank);
}
// DOMを組み立てる補助（必要な画面だけで使ってください）
export function makeHeaderDiv(suit, rank) {
    const d = document.createElement("div");
    d.className = "card-header";
    d.textContent = headerText(suit, rank);
    return d;
}
export function makeCenterDiv(suit, rank) {
    const c = document.createElement("div");
    c.className = "card-center";
    c.innerHTML = `
    <span class="center-suit">${suitGlyph(suit)}</span>
    <span class="center-rank">${rankToLabel(rank)}</span>
  `;
    return c;
}
// CSSクラス補助
export function cardCssClassBySuit(suit) {
    return `card ${suitColor(suit)}`;
}
export function cardCssClassByColor(color) {
    return `card ${color}`;
}
