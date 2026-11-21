"""Independent oracle for Prereg's golden numbers (Python stdlib only).

Written during design (2026-11-17), before any app code exists, so the Node
engine can be checked against a second implementation. Run:
    python3 -I golden_check.py
It prints every number the DESIGN.md test script quotes.
"""
import math

# ---------- distributions ----------
def phi(z):            # standard normal CDF
    return 0.5 * math.erfc(-z / math.sqrt(2))

def zq(p):             # standard normal quantile by bisection (|err| < 1e-12)
    lo, hi = -40.0, 40.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if phi(mid) < p: lo = mid
        else: hi = mid
    return (lo + hi) / 2

def gammaincc(a, x):   # regularized upper incomplete gamma Q(a, x) (Numerical Recipes)
    if x <= 0: return 1.0
    if x < a + 1:
        s, term, n = 1.0 / a, 1.0 / a, a
        for _ in range(10000):
            n += 1; term *= x / n; s += term
            if abs(term) < abs(s) * 1e-15: break
        return 1.0 - s * math.exp(-x + a * math.log(x) - math.lgamma(a))
    b = x + 1 - a; c = 1e300; d = 1 / b; h = d
    for i in range(1, 10000):
        an = -i * (i - a); b += 2
        d = an * d + b; d = 1e-300 if abs(d) < 1e-300 else d
        c = b + an / c; c = 1e-300 if abs(c) < 1e-300 else c
        d = 1 / d; de = d * c; h *= de
        if abs(de - 1) < 1e-15: break
    return math.exp(-x + a * math.log(x) - math.lgamma(a)) * h

def chi2_sf(x, df):
    return gammaincc(df / 2, x / 2)

# closed-form cross-checks for df = 1 and 2
for x in (0.5, 3.84, 48.0):
    assert abs(chi2_sf(x, 1) - math.erfc(math.sqrt(x / 2))) < 1e-12
    assert abs(chi2_sf(x, 2) - math.exp(-x / 2)) < 1e-12

# ---------- engine pieces ----------
def srm(units, weights):
    total = sum(units); wsum = sum(weights)
    exp = [total * w / wsum for w in weights]
    chi = sum((o - e) ** 2 / e for o, e in zip(units, exp))
    return chi, chi2_sf(chi, len(units) - 1), [round(100 * u / total, 2) for u in units]

def prop(s, n):
    p = s / n
    return p, p * (1 - p) / n           # value, variance of the estimate

def mean_stat(m, sd, n):
    return m, sd * sd / n

def compare(c, t):
    """c, t = (value, var). Returns abs diff, se, z, two-sided p, rel lift, rel CI95."""
    d = t[0] - c[0]; se = math.sqrt(c[1] + t[1]); z = d / se
    p2 = math.erfc(abs(z) / math.sqrt(2))   # = 2(1 - Phi(|z|)) without cancellation
    rel = t[0] / c[0] - 1
    se_rel = (t[0] / c[0]) * math.sqrt(t[1] / t[0] ** 2 + c[1] / c[0] ** 2)  # delta method
    zc = zq(0.975)
    return dict(diff=d, se=se, z=z, p=p2, rel=rel, rel_lo=rel - zc * se_rel, rel_hi=rel + zc * se_rel, se_rel=se_rel)

def holm(pvals, alpha):
    order = sorted(range(len(pvals)), key=lambda i: pvals[i]); k = len(pvals)
    adj = [0.0] * k; running = 0.0; reject = [False] * k; still = True
    for rank, i in enumerate(order):
        running = max(running, min(1.0, (k - rank) * pvals[i])); adj[i] = running
        if still and pvals[i] <= alpha / (k - rank): reject[i] = True
        else: still = False
    return adj, reject

def noninferior(c, t, margin, harm_up, relative, alpha=0.05):
    """Guardrail. harm_up=True: an increase is harmful. margin > 0.
    OK if the one-sided (1-alpha) upper bound of harm < margin;
    BREACH if the one-sided (1-alpha) lower bound of harm > margin; else UNCLEAR."""
    r = compare(c, t); z1 = zq(1 - alpha)
    if relative:
        harm = r['rel'] if harm_up else -r['rel']; se = r['se_rel']
    else:
        harm = r['diff'] if harm_up else -r['diff']; se = r['se']
    hi, lo = harm + z1 * se, harm - z1 * se
    status = 'OK' if hi < margin else ('BREACH' if lo > margin else 'UNCLEAR')
    p_ni = 0.5 * math.erfc(((margin - harm) / se) / math.sqrt(2))   # p-value of H0: harm >= margin
    return dict(harm=harm, hi=hi, lo=lo, status=status, p_ni=p_ni)

def plan_total(alpha, power, k, arms):
    """arms: list of (weight_fraction, var_per_unit, value) with arms[0] = control.
    Bonferroni alpha/k for planning. Returns total units N so each arm gets w*N."""
    za = zq(1 - alpha / k / 2); zb = zq(power)
    wc, vc, mc = arms[0]
    need = 0
    for (wt, vt, mt) in arms[1:]:
        delta = mt - mc
        need = max(need, (za + zb) ** 2 * (vc / wc + vt / wt) / delta ** 2)
    return math.ceil(need)

def pct(x, nd=2): return f"{100*x:.{nd}f}%"

out = []
def show(*a): out.append(" ".join(str(x) for x in a))

ALPHA, POWER = 0.05, 0.80
show("z(0.975)=%.6f z(0.80)=%.6f z(0.9875)=%.6f z(0.95)=%.6f" % (zq(0.975), zq(0.8), zq(0.9875), zq(0.95)))

# ---------- EXP-1 Annual plan preselected (SHIP) ----------
show("\n== EXP-1 annual plan preselected: primary checkout conversion 4.0% -> MDE +10% rel; guardrail 14-day refund rate (per purchase) must not rise > 1.0 pp")
b, m = 0.040, 0.10; p2 = b * (1 + m)
N1 = plan_total(ALPHA, POWER, 1, [(0.5, b*(1-b), b), (0.5, p2*(1-p2), p2)])
show("planned total", N1, "per arm", math.ceil(N1/2))
u = [41200, 41050]; chi, p, sh = srm(u, [50, 50]); show("SRM chi2=%.4f p=%.4f split=%s" % (chi, p, sh))
c = prop(1648, 41200); t = prop(1847, 41050); r = compare(c, t)
show("conv control %s treat %s diff %.4f pp rel %s CI95 rel [%s, %s] z=%.3f p=%.6f" % (pct(c[0]), pct(t[0]), 100*r['diff'], pct(r['rel']), pct(r['rel_lo']), pct(r['rel_hi']), r['z'], r['p']))
g = noninferior(prop(33, 1648), prop(35, 1847), 0.010, True, False)
show("refund ctrl %s treat %s harm %.3f pp upper95 %.3f pp -> %s (p_NI=%.4f)" % (pct(33/1648), pct(35/1847), 100*g['harm'], 100*g['hi'], g['status'], g['p_ni']))

# ---------- EXP-2 Onboarding email v2 (INVALID: SRM) ----------
show("\n== EXP-2 onboarding emails v2: 50/50, SRM")
u = [50412, 48233]; chi, p, sh = srm(u, [50, 50]); show("SRM chi2=%.2f p=%.3e split=%s" % (chi, p, sh))
c = prop(10890, 50412); t = prop(10859, 48233); r = compare(c, t)
show("(withheld) activation ctrl %s treat %s naive rel lift %s naive p=%.4f" % (pct(c[0]), pct(t[0]), pct(r['rel']), r['p']))
# judge step: the corrected query drops 2,112 bot sign-ups that only reached control (bots never activate)
u2 = [48300, 48233]; chi2v, p2v, sh2 = srm(u2, [50, 50]); show("after fix SRM chi2=%.4f p=%.4f split=%s" % (chi2v, p2v, sh2))
c = prop(10890, 48300); t = prop(10859, 48233); r = compare(c, t)
show("after fix activation ctrl %s treat %s diff %.3f pp rel %s CI95 rel [%s, %s] p=%.6f" % (pct(c[0]), pct(t[0]), 100*r['diff'], pct(r['rel']), pct(r['rel_lo']), pct(r['rel_hi']), r['p']))
b2, m2 = 0.215, 0.05; q2 = b2*(1+m2)
N2 = plan_total(ALPHA, POWER, 1, [(0.5, b2*(1-b2), b2), (0.5, q2*(1-q2), q2)])
show("EXP-2 planned total", N2, "per arm", math.ceil(N2/2))
g = noninferior(prop(212, 48300), prop(221, 48233), 0.0015, True, False)
show("unsubscribe ctrl %s treat %s harm %.3f pp upper95 %.3f pp -> %s" % (pct(212/48300,3), pct(221/48233,3), 100*g['harm'], 100*g['hi'], g['status']))

# ---------- EXP-3 One-page checkout (NOT READY) ----------
show("\n== EXP-3 one-page checkout: baseline 4.5%, MDE +8% rel, min 14 days; day 6 of 14")
b3, m3 = 0.045, 0.08; q3 = b3*(1+m3)
N3 = plan_total(ALPHA, POWER, 1, [(0.5, b3*(1-b3), b3), (0.5, q3*(1-q3), q3)])
show("planned total", N3, "per arm", math.ceil(N3/2))
u = [31900, 31750]; chi, p, sh = srm(u, [50, 50]); show("SRM chi2=%.4f p=%.4f" % (chi, p))
prog = sum(u) / N3; rate = sum(u) / 6; days_needed = math.ceil(N3 / rate)
show("progress %s; accrual %.0f/day; days for sample %d; ready on day %d (min 14)" % (pct(prog,1), rate, days_needed, max(14, days_needed)))
# judge submits day-14 numbers
u = [55320, 55180]; chi, p, sh = srm(u, [50, 50]); show("day14 SRM chi2=%.4f p=%.4f" % (chi, p))
c = prop(2489, 55320); t = prop(2737, 55180); r = compare(c, t)
show("day14 conv ctrl %s treat %s diff %.3f pp rel %s CI95 rel [%s, %s] p=%.6f" % (pct(c[0]), pct(t[0]), 100*r['diff'], pct(r['rel']), pct(r['rel_lo']), pct(r['rel_hi']), r['p']))
g = noninferior(prop(52, 2489), prop(55, 2737), 0.010, True, False)
show("day14 refund ctrl %s treat %s harm %.3f pp upper95 %.3f pp -> %s" % (pct(52/2489), pct(55/2737), 100*g['harm'], 100*g['hi'], g['status']))

# ---------- EXP-4 Pro price $12 -> $14 (DON'T SHIP: guardrail breach) ----------
show("\n== EXP-4 Pro price 12->14: primary revenue per visitor (mean), guardrail checkout conversion must not fall > 5% relative")
u = [150200, 149800]; chi, p, sh = srm(u, [50, 50]); show("SRM chi2=%.4f p=%.4f" % (chi, p))
c = mean_stat(0.540, 2.488, 150200); t = mean_stat(0.567, 2.760, 149800); r = compare(c, t)
show("RPV ctrl $%.3f treat $%.3f diff $%.4f rel %s CI95 rel [%s, %s] z=%.3f p=%.4f" % (c[0], t[0], r['diff'], pct(r['rel']), pct(r['rel_lo']), pct(r['rel_hi']), r['z'], r['p']))
g = noninferior(prop(6759, 150200), prop(6067, 149800), 0.05, False, True)
show("conv ctrl %s treat %s rel %s harm(rel drop) %s lower95 %s upper95 %s -> %s" % (pct(6759/150200), pct(6067/149800), pct(6067/149800/(6759/150200)-1), pct(g['harm']), pct(g['lo']), pct(g['hi']), g['status']))
N4 = plan_total(ALPHA, POWER, 1, [(0.5, 2.488**2, 0.540), (0.5, 2.488**2, 0.540*1.06)])
show("EXP-4 planned (MDE +6% rel on RPV, sd 2.488) total", N4, "per arm", math.ceil(N4/2))

# ---------- EXP-5 Trial reminder subject line, 3 arms (INCONCLUSIVE after Holm) ----------
show("\n== EXP-5 subject lines: control vs B vs C (1/3 each); primary click-through 10.0%, MDE +5% rel")
b5, m5 = 0.10, 0.05; q5 = b5*(1+m5)
N5 = plan_total(ALPHA, POWER, 2, [(1/3, b5*(1-b5), b5), (1/3, q5*(1-q5), q5), (1/3, q5*(1-q5), q5)])
show("planned total", N5, "per arm", math.ceil(N5/3))
u = [72000, 72000, 72000]; chi, p, sh = srm(u, [1, 1, 1]); show("SRM chi2=%.4f p=%.4f" % (chi, p))
c = prop(7200, 72000); tb = prop(7445, 72000); tc = prop(7430, 72000)
rb, rc = compare(c, tb), compare(c, tc)
adj, rej = holm([rb['p'], rc['p']], ALPHA)
show("B %s rel %s p=%.4f holm=%.4f sig=%s | C %s rel %s p=%.4f holm=%.4f sig=%s" % (pct(tb[0]), pct(rb['rel']), rb['p'], adj[0], rej[0], pct(tc[0]), pct(rc['rel']), rc['p'], adj[1], rej[1]))
show("naive (unadjusted) would call both significant at 0.05:", rb['p'] < 0.05 and rc['p'] < 0.05)

# ---------- EXP-6 draft: sample-size calculator check ----------
show("\n== EXP-6 draft (social proof on signup): baseline 12.0%, MDE +5% rel, 50/50")
b6, m6 = 0.12, 0.05; q6 = b6*(1+m6)
N6 = plan_total(ALPHA, POWER, 1, [(0.5, b6*(1-b6), b6), (0.5, q6*(1-q6), q6)])
show("planned total", N6, "per arm", math.ceil(N6/2))
N6b = plan_total(ALPHA, POWER, 1, [(0.5, b6*(1-b6), b6), (0.5, (b6*1.1)*(1-b6*1.1), b6*1.1)])
show("if MDE +10% rel: total", N6b, "per arm", math.ceil(N6b/2))


# ---------- extras used by the sample data and the judge script ----------
show("\n== extras")
# EXP-1 secondary metric: average order value (descriptive only, R11)
r = compare(mean_stat(96.40, 41.0, 1648), mean_stat(112.80, 39.5, 1847))
show("EXP-1 AOV ctrl $96.40 treat $112.80 rel %s CI95 rel [%s, %s] p=%.3e (descriptive)" % (pct(r['rel']), pct(r['rel_lo']), pct(r['rel_hi']), r['p']))
# EXP-2 guardrail before the fix (withheld anyway because of SRM)
# EXP-3 earlier looks: SRM is still checked on every snapshot (R4)
for day, u in ((3, [15980, 15870]), (6, [31900, 31750])):
    chi, p, sh = srm(u, [50, 50]); show("EXP-3 day %d units %s SRM chi2=%.4f p=%.4f progress %s" % (day, u, chi, p, pct(sum(u)/108060, 1)))
# EXP-5 guardrail: unsubscribe rate must not rise more than 0.10 pp (absolute)
for arm, s in (("B", 221), ("C", 230)):
    g = noninferior(prop(216, 72000), prop(s, 72000), 0.0010, True, False)
    show("EXP-5 unsubscribe %s ctrl %s treat %s harm %.4f pp upper95 %.4f pp -> %s" % (arm, pct(216/72000, 3), pct(s/72000, 3), 100*g['harm'], 100*g['hi'], g['status']))
# EXP-4 early-harm rule would not fire at the final look (it is not used there); show the one-sided p of harm > 0
c = prop(6759, 150200); t = prop(6067, 149800); r = compare(c, t)
show("EXP-4 conversion drop one-sided p(harm>0)=%.3e" % (0.5 * math.erfc(-r['z'] / math.sqrt(2))))
# Twyman check: |rel lift| >= 4 x MDE ?
show("Twyman: EXP-1 %.2f vs 4xMDE 0.40 -> %s; EXP-3 %.3f vs 0.32 -> %s" % (0.1248, 0.1248 >= 0.40, 0.1024, 0.1024 >= 0.32))

print("\n".join(out))
