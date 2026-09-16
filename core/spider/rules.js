/**
 * ドラッグ開始時に、この srcRef から動かせるカード束を取得する
 * 返り値は「ドラッグ中の束」など。今はダミー。
 */
export function getMovableSeqForSourceSpider(state, srcRef) {
    // TODO: Spiderの選択ロジック
    return null;
}
/**
 * ドラッグ中、マウス座標などからドロップ先を推定する
 * 今はダミーで null を返す
 */
export function detectDropTargetSpider(state, draggedBundle, pointerPos) {
    // TODO: Spiderのドロップ先推定
    return null;
}
/**
 * 実ドロップ時に束を移す
 * stateを書き換えるか、新stateを返す
 * いまは何もしない
 */
export function tryMoveByRefsSpider(state, srcRef, destRef) {
    // TODO: Spiderの移動合法判定＋適用
    // trueなら成功、falseなら不許可みたいな想定
    return false;
}
/**
 * FINISHボタンを出して良いか
 * Spiderは「もうあとは自動で完成列を抜くだけ」の状態などを判定する予定
 * 今は常に false
 */
export function isSpiderReadyForFinishNow(state) {
    // TODO: SpiderのFINISH条件
    return false;
}
/**
 * FINISH中に1ステップだけ自動処理を進める
 * 進展があれば true、もうやることなければ false
 * 今は何もしない
 */
export function autoSweepSafeStepSpider(state) {
    // TODO: Spiderの自動片付け(完成したA-K列を除去する等)
    return false;
}
