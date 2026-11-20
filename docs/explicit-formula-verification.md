# 明示公式による ψ(x) / ψ₁(x) 再構成の検証

`scripts/verify-explicit-formula.mjs`（Node、依存なし）の実行結果。零点は `shared/zeta-zeros-1000.js`（`scripts/generate-zeros.py` が mpmath 1.4.1 で生成）。

## 使った式と出典

- ψ₀(x) = x − Σ_{ρ: Im ρ>0} 2Re(x^ρ/ρ) − ln(2π) − ½ln(1−x⁻²)（ψ₀ は不連続点で左右極限の平均を取る正規化 ψ。和は Im ρ>0 の零点のみで、共役零点の寄与は 2Re に含まれる。Davenport 第17章 / Montgomery–Vaughan §12.1）
- ψ₁(x) = Σ_{n≤x} Λ(n)(x−n) = x²/2 − Σ_ρ x^{ρ+1}/(ρ(ρ+1)) − (ζ′/ζ(0))·x + ζ′/ζ(−1) − Σ_{k≥1} x^{1−2k}/(2k(2k−1))
  - 出典: de la Vallée Poussin (1896)。Montgomery & Vaughan, *Multiplicative Number Theory I*, §12.1 Exercise 6 に記載の式を確認した（PDF 本文で照合）。Davenport 本体は直接参照できていない。
  - ζ′/ζ(0) = ln 2π。ζ′/ζ(−1) = 1.98505372440541115…（mpmath 1.4.1 で計算）。
- 誤差上限（**RH を仮定した場合**）: Schoenfeld の明示形 |ψ(x) − x| ≤ (1/8π)√x ln²x（x ≥ 73.2）。ψ₁ 側はその積分。t < 73.2 では上限を主張しないため、∫₀^{73.2}(ψ−t)dt は実測値で加算した。RH は仮定であり、ここで証明されるものではない。

## 結論

- 交差検証 (a) 明示公式 ψ_N の数値積分 vs ψ₁ 閉形式、(b) 実測 ψ の数値積分 vs ψ₁（Λ 和）は、いずれも相対誤差 1e-12 程度以下で一致（定数項は x=100, N=1000 の絶対残差 0.006 で確認）。
- N を増やすと ψ₁ 残差の RMS は単調に減少（dense RMS: 50399.6 → 17972.6 → 6636.7 → 1980.1 → 512.6）。成功条件を満たした。
- ψ 自体の残差は不連続関数の打ち切りのため収束が遅く、グリッド RMS は N=30 → 100 → 300 → 1000 で 31.4 → 13.0 → 6.13 → 9.48 と単調ではない（グリッド点が少なく Gibbs 的振動の影響を受ける）。ψ₁ の方が積分により平滑化され、収束が明瞭。
- 実測誤差 |ψ−x|, |ψ₁−x²/2| は全グリッド点で RH 仮定下の上限の内側だった（上限はかなり緩い）。
- 零点チェック: 1000 個、単調増加、1番目 14.13472514、100番目 236.52422967（既存 236.524230 と差 1e-6 未満、最大差 9.8e-7）、1000番目 1419.42248095。

## 実行出力（全文）

```text
== Cross-check of psi1 closed form (differences over [x1,x2]) ==
   (a) numeric integral of explicit psi_N  vs  psi1_N closed form
   (b) numeric integral of measured psi (step function)  vs  psi1 from Lambda
  [PASS] (b) measured psi integral == psi1 Lambda-sum: int=51195325149.046 psi1diff=51195325149.047 rel=5.22e-15
  [PASS] (a) N=10 explicit-psi integral == psi1 closed form: max|diff|=3.74e-4 maxRel=6.47e-14
  [PASS] (a) N=100 explicit-psi integral == psi1 closed form: max|diff|=4.43e-4 maxRel=5.38e-13
  [PASS] (a) N=1000 explicit-psi integral == psi1 closed form: max|diff|=1.14e-3 maxRel=3.54e-13
  [PASS] absolute psi1 at x=100, N=1000 (validates constants): residual=0.0063 (a wrong constant term would shift this by ~1.985)

== psi1 residual (measured - reconstructed) at grid x ==
       x           N=10           N=30          N=100          N=300         N=1000
     100           0.15           0.67           0.30          -0.05           0.01
     300          15.77           0.25          -0.43          -0.04           0.03
    1000          44.02          28.64           2.95          -0.15          -0.30
    3000        -201.19         -54.27          -2.88         -14.80          -4.99
   10000        1475.59        1507.10         326.36          26.15           3.94
   30000        6831.46        1045.64          -8.85         377.30         -10.34
  100000      -20760.00       10108.24        3017.86        1281.41        -141.29
  320000     -143357.55      -62910.72      -46241.85      -10137.48       -1086.70
RMS grid        51272.87       22536.92       16384.15        3615.14         387.46
RMS dense       50399.58       17972.58        6636.74        1980.09         512.62
RMS/x^1.5       1.334e-3       5.722e-4       1.789e-4       5.645e-5       1.444e-5   (dense = 400 log-spaced x in [100,320000])

== psi residual (measured - reconstructed) at grid x ==
       x       N=10       N=30      N=100      N=300     N=1000
     100      -1.00      -0.87       0.38      -0.02       0.03
     300      -0.60       0.49       0.32      -0.09      -0.00
    1000      -0.53       3.00       2.71      -0.03      -0.35
    3000      -2.82      -5.13      -4.19       1.60      -0.30
   10000      -7.93      -7.50      -5.70      -5.28      -4.68
   30000     -23.19     -11.59      -7.33       1.17      -1.88
  100000       0.86      16.23      29.19      16.22      -1.54
  320000      81.98      85.90      19.78      -2.40     -26.29
RMS grid       30.27      31.36      13.01       6.13       9.48

== Error vs bound assuming RH (Schoenfeld: |psi(x)-x| <= (1/8pi) sqrt(x) ln^2 x for x>=73.2) ==
  psi1 bound = |psi1(73.2)-73.2^2/2| (measured, 137.530) + (1/8pi) int_73.2^x sqrt(t) ln^2 t dt
       x        |psi-x|          bound        inside?   |psi1-x^2/2|     psi1 bound        inside?
     100           5.95           8.44            yes         195.01         334.92            yes
     300           0.77          22.42            yes         482.90        3470.08            yes
    1000           3.32          60.04            yes        2141.39       32957.52            yes
    3000           1.09         139.70            yes        2835.27      236653.92            yes
   10000          13.40         337.53            yes       17321.35     1947936.46            yes
   30000          38.65         732.40            yes       21201.41    12875939.39            yes
  100000          51.56        1667.75            yes       32290.97    99052644.74            yes
  320000          46.67        3616.64            yes     4670045.96   694661718.57            yes
  All grid points inside the (RH-conditional) bounds.

== Success criterion: psi1 residual RMS decreases with N ==
  [PASS] RMS(dense) strictly decreasing in N: 50399.6 > 17972.6 > 6636.7 > 1980.1 > 512.6
  [PASS] RMS(dense)/x^1.5 strictly decreasing in N: 1.33e-3 > 5.72e-4 > 1.79e-4 > 5.65e-5 > 1.44e-5

ALL CHECKS PASSED
```
