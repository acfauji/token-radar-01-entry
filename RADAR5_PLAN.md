# Radar-5 Deep Improvement Plan

## Current Score Analysis: 63.7% (interval 58.1%-69.4%)
**Gap to 99%**: Need to dominate pairwise comparisons on all 5 judge criteria.

---

## Winner Pattern Analysis (from 6 public entries)

| Winner | Key Innovation | Model Validation | Economic Verdict |
|--------|---------------|------------------|------------------|
| **ItzSudhan** | Tiered size multiple, self-correction in transcript | Model sandbox | Basic farm plans |
| **0xcqing** | Power-law + robust trim + category factors + P10-P90 bands | Blind backtest (3.15x vs 5.22x) | Sensitivity grid (deposit × share) |
| **jonsonbmth (V2)** | **Model validation ON COVER**: scatter, LOO, walk-forward, ablation | LOO RMSE 2.107 vs 2.310 flat; walk-forward wins all 4 cutoffs | **Launch odds × value = implied value**, FARM/THIN/SKIP verdicts, sensitivity grid |
| **a03042901** | Category k-multiplier, momentum, maturity, heuristic exclusions | Category-sensitive | Costed farm plans |
| **agensi (radar-5)** | Log-log curve, R² 0.104, 0.33×-4.12× bands, shrunk offsets | 5-fold CV, median log error 0.49 | FARM/THIN/SKIP with net $ at low band |

---

## Critical Gaps in Current Entry

| Missing Feature | Winner Evidence | Impact on Judge Criteria |
|-----------------|-----------------|--------------------------|
| **Launch probability model** | jonsonbmth (hazard curve), agensi | Criteria #2: "implied value follows from snapshot figures" |
| **Value ranges (P10-P90)** | 0xcqing (P10-P90), jonsonbmth (P25-P75), agensi (0.33×-4.12×) | Criteria #2: honest uncertainty |
| **Rank ranges (bootstrap)** | jonsonbmth (40 bootstrap refits) | Criteria #2: rank uncertainty |
| **Walk-forward validation ON COVER** | jonsonbmth (4 cutoffs, beats flat) | Criteria #2: "not from hardcoded list" |
| **Ablation studies** | jonsonbmth (growth/age tested, rejected) | Criteria #2: model derived from snapshot |
| **Economic verdicts (FARM/THIN/SKIP)** | jonsonbmth, agensi, a03042901 | Criteria #3: "concrete steps with what they cost" |
| **Sensitivity grids in detail view** | jonsonbmth, agensi, 0xcqing | Criteria #4: dashboard usability |
| **Transparent limitations section** | jonsonbmth, agensi | Criteria #5: "it looks made" - honesty |
| **Scatter plot + residuals on cover** | jonsonbmth V2 | Criteria #5: visual craft |
| **Rank uncertainty (bootstrap)** | jonsonbmth (40 bootstrap refits) | Criteria #2: rank uncertainty |

---

## Radar-5 Specification

### Model Architecture
```
value_if_launches = BASE_COEFF × TVL^BASE_EXPONENT × family_factor × growth_mult × seasoning_mult
launch_odds = mean(age_band_rate, category_rate)  // shrunk toward global, clamped 5-90%
implied_value = value_if_launches × launch_odds

value_range = implied_value × residual_quantiles  // P25-P75, P10-P90
rank_range = bootstrap_rank_quantiles  // 40 bootstrap refits
verdict = FARM/THIN/SKIP based on net at low end of value_range
```

### Launch Probability Model (Hazard Curve)
- **Age bands**: <180d, 180-365d, 1-2y, 2-3y, 3-5y, >5y
- **Category rates**: per-category launch rate, shrunk toward global (k=10)
- **Combined**: mean(age_rate, cat_rate), clamped 5%-90%

### Value Ranges
- **Residual quantiles** from leave-one-out: P10, P25, P75, P90
- **Value band**: implied × [P25, P75] for summary, × [P10, P90] for detail
- **Rank band**: 40 bootstrap refits of size curve → rank P25-P75

### Economic Verdict
- **Assumptions**: airdrop_share (default 7.5%), farming_tvl_share (25%), season (180d), gas table
- **Farmer slice** = implied × airdrop_share × (deposit_days/season) × farming_tvl_share
- **Cost** = gas (3 txs) + opportunity cost (8% APY)
- **Net** = slice - cost
- **Verdict**: FARM (net ≥ $25), MARGINAL (net ≥ $0), SKIP (net < $0)
- **Sensitivity grid**: deposit ($1K/$10K/$100K) × airdrop share (5%/10%/20%)

### Model Validation (on cover)
1. **Scatter plot**: log mcap vs log TVL with fitted curve
2. **Residuals vs fitted**: check heteroscedasticity
3. **Leave-one-out**: RMSE vs flat multiple
4. **Walk-forward table**: 4 cutoffs (2024-01-01, 2024-07-01, 2025-01-01, 2025-07-01)
5. **Ablation table**: growth, age, chain count, category offsets - tested and rejected
6. **Residual quantiles**: P10, P25, P50, P75, P90

### Dashboard Enhancements
1. **Cover panel**: Model validation (scatter + walk-forward table)
2. **Detail view**: Sensitivity grid (deposit × airdrop share), nearest traded comparables, value derivation steps
3. **Verdict column** on board: FARM/MARGINAL/SKIP with color coding
4. **Sensitivity grid** in detail: deposit × airdrop share → net, verdict
5. **Limitations panel**: honest about R², bands, assumptions
5. **Rank range badge**: P25-P75 rank

---

## Implementation Priority (Time-Boxed)

| Phase | Task | Est. Time |
|-------|------|-----------|
| 1 | Enhanced model (launch odds, value ranges, bootstrap ranks, verdicts) | 2h |
| 2 | Model validation computations (scatter data, residuals, walk-forward, ablation) | 1.5h |
| 3 | Dashboard: cover validation panel, sensitivity grid, verdict column, rank range | 2h |
| 4 | Detail view: sensitivity grid, nearest comparables, step-by-step derivation | 1.5h |
| 5 | Limitations panel, rank range badge, visual polish | 1h |
| 6 | Local check, fresh screenshots, deterministic verification | 30m |
| **Total** | **~8.5h** | |

---

## Success Metrics for "99%"

| Metric | Target |
|--------|--------|
| Provisional rate | > 0.85 (beats r1=1.565) |
| Interval low | > 0.80 (clears money-line easily) |
| All gate checks | Pass |
| Deterministic | Byte-identical 2 runs |
| Transcript gate | > 80% authored, 150+ turns |
| Visual distinctiveness | Custom, memorable, not framework |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Model overcomplication → non-determinism | Fixed seeds, pure functions, no randomness in output |
| Bootstrap non-determinism | Fixed PRNG seed (splitmix64) |
| Transcript gate failure | Rewrite ALL files in-session, ≥3 revisions on model.ts/main.ts |
| Quota exhaustion | Local check FIRST, only submit when 100% clean |
| Visual regression | Custom CSS, no frameworks, pixel-perfect screenshots |

---

**Next Step**: Begin Phase 1 - Enhanced model implementation.