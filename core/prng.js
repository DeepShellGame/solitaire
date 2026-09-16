// シンプルな32bit xorshift PRNG
export class PRNG {
    seed;
    constructor(seed) {
        this.seed = seed >>> 0;
    }
    next() {
        let x = this.seed >>> 0;
        x ^= x << 13;
        x >>>= 0;
        x ^= x >> 17;
        x >>>= 0;
        x ^= x << 5;
        x >>>= 0;
        this.seed = x >>> 0;
        return this.seed;
    }
    nextFloat() {
        // 0 <= n < 1
        return this.next() / 0xffffffff;
    }
    shuffleInPlace(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(this.nextFloat() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }
}
