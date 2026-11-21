// Sample data (all fictional). Dates are relative to the load time D, so the verdicts and numbers are
// the same on any day. Every number these produce is checked against research/golden_values.json.

export const DEMO_PROJECT = 'GRO';

/** YYYY-MM-DD of D plus offset days (UTC). */
export const ymd = (D, offset = 0) => new Date(Date.UTC(D.getUTCFullYear(), D.getUTCMonth(), D.getUTCDate() + offset)).toISOString().slice(0, 10);

export const DEMO = [
  {
    ref: 'EXP-1',
    title: 'Annual plan preselected on the pricing page',
    hypothesis: 'Preselecting the annual plan raises checkout conversion without raising refunds.',
    spec: {
      armsSpec: 'control:50, annual:50',
      primarySpec: 'checkout_conversion | proportion | increase | baseline 4% | mde 10% | def Pricing-page visitors who completed checkout',
      guardrailsSpec: 'refund_14d | proportion | increase is harm | margin 1.0pp | def Purchases refunded within 14 days',
      secondarySpec: 'aov | mean | def Average order value in USD',
      minDays: 14,
    },
    launch: -21,
    readouts: [{
      asOf: -7, source: 'warehouse query: checkout_daily', note: '',
      csv: 'arm,units,checkout_conversion,refund_14d,aov\ncontrol,41200,1648,33/1648,96.40|41.0|1648\nannual,41050,1847,35/1847,112.80|39.5|1847',
    }],
  },
  {
    ref: 'EXP-2',
    title: 'Onboarding email sequence v2',
    hypothesis: 'A shorter, task-led email sequence raises 7-day activation.',
    spec: {
      armsSpec: 'control:50, sequence_v2:50',
      primarySpec: 'activation_7d | proportion | increase | baseline 21.5% | mde 5% | def New sign-ups who complete setup within 7 days',
      guardrailsSpec: 'unsubscribe | proportion | increase is harm | margin 0.15pp | def Sign-ups who unsubscribed from onboarding emails',
      secondarySpec: '',
      minDays: 14,
    },
    launch: -20,
    readouts: [{
      asOf: -6, source: 'AI analyst: warehouse query v1', note: 'Analyst summary: activation +4.2%, ship it.',
      csv: 'arm,units,activation_7d,unsubscribe\ncontrol,50412,10890,212\nsequence_v2,48233,10859,221',
    }],
  },
  {
    ref: 'EXP-3',
    title: 'One-page checkout',
    hypothesis: 'Putting shipping and payment on one page raises checkout conversion.',
    spec: {
      armsSpec: 'control:50, one_page:50',
      primarySpec: 'checkout_conversion | proportion | increase | baseline 4.5% | mde 8% | def Cart visitors who completed checkout',
      guardrailsSpec: 'refund_14d | proportion | increase is harm | margin 1.0pp | def Purchases refunded within 14 days',
      secondarySpec: '',
      minDays: 14,
    },
    launch: -15,
    readouts: [
      { asOf: -12, source: 'warehouse query: checkout_daily', note: 'day 3 check-in', csv: 'arm,units,checkout_conversion,refund_14d\ncontrol,15980,719,15/719\none_page,15870,787,16/787' },
      { asOf: -9, source: 'warehouse query: checkout_daily', note: 'day 6 check-in', csv: 'arm,units,checkout_conversion,refund_14d\ncontrol,31900,1436,30/1436\none_page,31750,1571,31/1571' },
    ],
  },
  {
    ref: 'EXP-4',
    title: 'Pro plan price $12 to $14',
    hypothesis: 'A $14 Pro price raises revenue per visitor without losing more than 5% of conversions.',
    spec: {
      armsSpec: 'control:50, price_14:50',
      primarySpec: 'revenue_per_visitor | mean | increase | baseline 0.54 | sd 2.488 | mde 6% | def Revenue per pricing-page visitor in USD',
      guardrailsSpec: 'checkout_conversion | proportion | decrease is harm | margin 5% | def Pricing-page visitors who completed checkout',
      secondarySpec: '',
      minDays: 14,
    },
    launch: -18,
    readouts: [{
      asOf: -4, source: 'billing export: pro_trial_revenue', note: '',
      csv: 'arm,units,revenue_per_visitor,checkout_conversion\ncontrol,150200,0.540|2.488,6759\nprice_14,149800,0.567|2.760,6067',
    }],
  },
  {
    ref: 'EXP-5',
    title: 'Trial-reminder subject line',
    hypothesis: 'A curiosity or a deadline subject line raises click-through on the trial reminder.',
    spec: {
      armsSpec: 'control:1, curiosity:1, deadline:1',
      primarySpec: 'click_through | proportion | increase | baseline 10% | mde 5% | def Recipients who clicked the reminder',
      guardrailsSpec: 'unsubscribe | proportion | increase is harm | margin 0.10pp | def Recipients who unsubscribed',
      secondarySpec: '',
      minDays: 14,
    },
    launch: -16,
    readouts: [{
      asOf: -2, source: 'email platform export: trial_reminder', note: '',
      csv: 'arm,units,click_through,unsubscribe\ncontrol,72000,7200,216\ncuriosity,72000,7445,221\ndeadline,72000,7430,230',
    }],
  },
  {
    ref: 'EXP-6',
    title: 'Social proof on the sign-up page',
    hypothesis: 'Showing how many teams signed up this week raises sign-up conversion.',
    spec: {
      armsSpec: 'control:50, social_proof:50',
      primarySpec: 'signup_conversion | proportion | increase | baseline 12% | mde 5% | def Sign-up page visitors who created an account',
      guardrailsSpec: 'support_contact | proportion | increase is harm | margin 0.5pp | def New accounts that contacted support in 7 days',
      secondarySpec: '',
      minDays: 14,
    },
    launch: null,
    readouts: [],
  },
];

/** The judge's corrected readouts (TESTING.md steps), as of the load day. */
export const JUDGE_CSV = {
  'EXP-2': 'arm,units,activation_7d,unsubscribe\ncontrol,48300,10890,212\nsequence_v2,48233,10859,221',
  'EXP-3': 'arm,units,checkout_conversion,refund_14d\ncontrol,55320,2489,52/2489\none_page,55180,2737,55/2737',
  'EXP-5-extra-column': 'arm,units,click_through,unsubscribe,open_rate\ncontrol,72000,7200,216,18000\ncuriosity,72000,7445,221,19100\ndeadline,72000,7430,230,18800',
};
