const KEY = "ClearGuaranteeEnabledV1";
export function loadClearGuaranteeEnabled() {
    try {
        return localStorage.getItem(KEY) === "1";
    }
    catch {
        return false;
    }
}
export function saveClearGuaranteeEnabled(enabled) {
    try {
        localStorage.setItem(KEY, enabled ? "1" : "0");
    }
    catch {
        // localStorage が使えない環境では、そのセッション中だけ状態を保持する。
    }
}
