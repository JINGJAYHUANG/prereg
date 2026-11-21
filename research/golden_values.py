"""Full-precision values from the independent oracle, for the Node golden test.

It imports golden_check.py unchanged (its printing is silenced) and calls the same functions, so the
Node engine is compared with the oracle at full precision instead of the rounded printout. Run:
    python3 -I golden_values.py   (writes golden_values.json next to this file)
"""
import contextlib, io, json, math, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
with contextlib.redirect_stdout(io.StringIO()):
    import golden_check as g

A, P = 0.05, 0.80
v = {}

def cmp(c, t):
    r = g.compare(c, t)
    return {k: r[k] for k in ('diff', 'se', 'z', 'p', 'rel', 'rel_lo', 'rel_hi')}

def ni(c, t, margin, up, rel):
    r = g.noninferior(c, t, margin, up, rel)
    return {k: r[k] for k in ('harm', 'hi', 'lo', 'status')}

def srm(u, w):
    chi, p, _ = g.srm(u, w)
    return {'chi2': chi, 'p': p}

def plan_prop(b, m, k, w):
    q = b * (1 + m)
    arms = [(w[0], b * (1 - b), b)] + [(wi, q * (1 - q), q) for wi in w[1:]]
    n = g.plan_total(A, P, k, arms)
    return {'total': n, 'per_arm': [math.ceil(wi * n) for wi in w]}

# EXP-1
v['exp1'] = {'plan': plan_prop(0.040, 0.10, 1, [0.5, 0.5]), 'srm': srm([41200, 41050], [50, 50]),
             'primary': cmp(g.prop(1648, 41200), g.prop(1847, 41050)),
             'refund': ni(g.prop(33, 1648), g.prop(35, 1847), 0.010, True, False),
             'aov': cmp(g.mean_stat(96.40, 41.0, 1648), g.mean_stat(112.80, 39.5, 1847))}
# EXP-2 (as submitted, then corrected)
v['exp2'] = {'plan': plan_prop(0.215, 0.05, 1, [0.5, 0.5]), 'srm': srm([50412, 48233], [50, 50]),
             'srm_fixed': srm([48300, 48233], [50, 50]),
             'primary_fixed': cmp(g.prop(10890, 48300), g.prop(10859, 48233)),
             'unsub_fixed': ni(g.prop(212, 48300), g.prop(221, 48233), 0.0015, True, False)}
# EXP-3 (day 3, day 6, final)
v['exp3'] = {'plan': plan_prop(0.045, 0.08, 1, [0.5, 0.5]), 'srm_d3': srm([15980, 15870], [50, 50]),
             'srm_d6': srm([31900, 31750], [50, 50]), 'srm_final': srm([55320, 55180], [50, 50]),
             'primary_final': cmp(g.prop(2489, 55320), g.prop(2737, 55180)),
             'refund_final': ni(g.prop(52, 2489), g.prop(55, 2737), 0.010, True, False)}
# EXP-4
n4 = g.plan_total(A, P, 1, [(0.5, 2.488 ** 2, 0.540), (0.5, 2.488 ** 2, 0.540 * 1.06)])
c4, t4 = g.prop(6759, 150200), g.prop(6067, 149800)
r4 = g.compare(c4, t4)
v['exp4'] = {'plan': {'total': n4, 'per_arm': [math.ceil(n4 / 2)] * 2}, 'srm': srm([150200, 149800], [50, 50]),
             'primary': cmp(g.mean_stat(0.540, 2.488, 150200), g.mean_stat(0.567, 2.760, 149800)),
             'conv': ni(c4, t4, 0.05, False, True),
             'harm_p': 0.5 * math.erfc(-r4['z'] / math.sqrt(2))}
# EXP-5
c5 = g.prop(7200, 72000)
rb, rc = g.compare(c5, g.prop(7445, 72000)), g.compare(c5, g.prop(7430, 72000))
adj, rej = g.holm([rb['p'], rc['p']], A)
v['exp5'] = {'plan': plan_prop(0.10, 0.05, 2, [1 / 3] * 3), 'srm': srm([72000] * 3, [1, 1, 1]),
             'curiosity': cmp(c5, g.prop(7445, 72000)), 'deadline': cmp(c5, g.prop(7430, 72000)),
             'holm': adj, 'reject': rej,
             'unsub_curiosity': ni(g.prop(216, 72000), g.prop(221, 72000), 0.0010, True, False),
             'unsub_deadline': ni(g.prop(216, 72000), g.prop(230, 72000), 0.0010, True, False)}
# EXP-6
v['exp6'] = {'plan': plan_prop(0.12, 0.05, 1, [0.5, 0.5]), 'plan_mde10': plan_prop(0.12, 0.10, 1, [0.5, 0.5])}

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'golden_values.json')
with open(out, 'w') as f:
    json.dump(v, f, indent=1)
print('wrote', out)
