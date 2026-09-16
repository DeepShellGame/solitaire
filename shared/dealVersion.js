/**
 * 盤面生成ロジックの互換性バージョン。
 *
 * クリア済みシードを長期保存するため、seed だけでなくこの値も保存する。
 * 配り方・PRNG・難易度ごとの初期盤面生成を変更して、同じ seed から別盤面が
 * 生成されるようになる場合だけ、対象ゲームの値を +1 すること。
 *
 * 現在の v1 は、既存の GitHub 公開版と同じ盤面生成を維持する。
 */
export const DEAL_VERSION_BY_MODE = {
    freecell: 1,
    klondike: 1,
    spider: 1,
};
export function getDealVersion(mode) {
    return DEAL_VERSION_BY_MODE[mode];
}
