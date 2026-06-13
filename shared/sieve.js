// Sieve of Eratosthenes implementation
// Computes prime flags, prime gaps, and smallest prime factors (SPF) array.

export function buildSieve(MAX) {
    const isPrime = new Uint8Array(MAX + 1);
    isPrime.fill(1);
    isPrime[0] = isPrime[1] = 0;
    
    for (let i = 2; i * i <= MAX; i++) {
        if (isPrime[i]) {
            for (let j = i * i; j <= MAX; j += i) {
                isPrime[j] = 0;
            }
        }
    }

    const gaps = new Uint8Array(MAX + 2);
    let prev = 2;
    for (let i = 3; i <= MAX; i++) {
        if (isPrime[i]) {
            gaps[prev] = Math.min(i - prev, 255);
            prev = i;
        }
    }

    const spf = new Int32Array(MAX + 1);
    for (let i = 0; i <= MAX; i++) {
        spf[i] = i;
    }
    for (let i = 2; i * i <= MAX; i++) {
        if (spf[i] === i) {
            for (let j = i * i; j <= MAX; j += i) {
                if (spf[j] === j) {
                    spf[j] = i;
                }
            }
        }
    }

    return { isPrime, gaps, spf };
}
