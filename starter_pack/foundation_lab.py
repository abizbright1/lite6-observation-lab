"""Offline teaching exercises: no third-party packages, networking or robot SDK.

Python 3.9+. Units are millimetres and seconds unless explicitly stated.
All examples are synthetic. They are not a validated robot model or new research.
"""
import argparse
import json
import math
import random
from pathlib import Path


def target_interval(z_mm, velocity_mm_s, age_lo_s, age_hi_s, bias_bound_mm,
                    noise_bound_mm):
    """Enclose X from z = X + v*age + bias + noise.

    This simple model describes a static target viewed by a translating camera,
    with the old image combined with the CURRENT camera position. Constant v,
    local metric image coordinates, and correct declared bounds are assumptions.
    It does not model camera rotation, perspective changes, contact or collision.
    """
    values = (z_mm, velocity_mm_s, age_lo_s, age_hi_s, bias_bound_mm,
              noise_bound_mm)
    if not all(math.isfinite(x) for x in values):
        raise ValueError('Every input must be finite')
    if age_lo_s < 0 or age_hi_s < age_lo_s:
        raise ValueError('Ages must satisfy 0 <= lower <= upper')
    if bias_bound_mm < 0 or noise_bound_mm < 0:
        raise ValueError('Error bounds must be nonnegative')
    corners = [z_mm - velocity_mm_s * age - bias - noise
               for age in (age_lo_s, age_hi_s)
               for bias in (-bias_bound_mm, bias_bound_mm)
               for noise in (-noise_bound_mm, noise_bound_mm)]
    return min(corners), max(corners)


def approves(interval, command_mm, tolerance_mm):
    """True only if EVERY position in this interval fits this one command."""
    if (not all(math.isfinite(x) for x in (*interval, command_mm, tolerance_mm))
            or tolerance_mm < 0 or interval[0] > interval[1]):
        raise ValueError('Invalid interval, command or tolerance')
    return max(abs(interval[0] - command_mm),
               abs(interval[1] - command_mm)) <= tolerance_mm


def timing():
    speed = 60.0
    age_ms = 30.0
    displacement = speed * age_ms / 1000.0
    result = {'speed_mm_s': speed, 'age_ms': age_ms,
              'displacement_mm': displacement,
              'exposure_s': 10.000, 'host_dequeue_s': 10.080,
              'decision_s': 10.090,
              'exposure_to_decision_ms': 90,
              'dequeue_to_decision_ms': 10}
    print('LESSON 1: units and clocks')
    print('60 mm/s x 30 ms / 1000 = %.1f mm.' % displacement)
    print('Synthetic SAME-CLOCK example: exposure 10.000 s, dequeue 10.080 s,')
    print('decision 10.090 s. Frame age is 90 ms, not 10 ms.')
    print('Real timestamps must first have a justified clock mapping.\n')
    return result


def interval_lesson():
    possible = target_interval(102.0, 60.0, .020, .060, .6, .1)
    result = {'apparent_target_mm': 102.0, 'command_mm': 100.0,
              'age_interval_s': [.020, .060], 'bias_bound_mm': .6,
              'noise_bound_mm': .1, 'possible_target_mm': list(possible),
              'approve_tolerance_3mm': approves(possible, 100.0, 3.0),
              'approve_tolerance_2mm': approves(possible, 100.0, 2.0)}
    print('LESSON 2: one estimate versus a set of possible targets')
    print('Apparent target: 102 mm; proposed command: 100 mm.')
    print('Possible actual target interval: [%.1f, %.1f] mm.' % possible)
    print('Fits +/-3 mm:', result['approve_tolerance_3mm'])
    print('Fits +/-2 mm:', result['approve_tolerance_2mm'])
    print('These tolerances are teaching choices, not robot settings.\n')
    return result


def ambiguity():
    """Scalar dependency illustration; moving reference, not platform model."""
    v0, age_max, observed, horizon = 100.0, .1, 200.0, .05
    rows = []
    for velocity, radius in ((100.0, 5.0), (-100.0, 5.0), (200.0, 12.0)):
        # Calibration enforces b = v0 * age. Endpoints suffice for affine maps.
        coupled = [observed + velocity * horizon + (velocity-v0)*age
                   for age in (0.0, age_max)]
        box = [observed - bias + velocity*(age+horizon)
               for age in (0.0, age_max)
               for bias in (0.0, v0*age_max)]
        command = observed + velocity*horizon
        coupled = (min(coupled), max(coupled))
        box = (min(box), max(box))
        rows.append({'runtime_velocity_mm_s': velocity, 'command_mm': command,
                     'coupled_interval_mm': list(coupled),
                     'independent_box_interval_mm': list(box),
                     'tolerance_mm': radius,
                     'coupled_approve': approves(coupled, command, radius),
                     'box_approve': approves(box, command, radius)})
    print('LESSON 3: uncertain parameters can depend on each other')
    for row in rows:
        print('v=%g: coupled=%s; box=%s; approvals=%s / %s' % (
            row['runtime_velocity_mm_s'], row['coupled_interval_mm'],
            row['independent_box_interval_mm'], row['coupled_approve'],
            row['box_approve']))
    print('This illustrates standard joint-set reasoning; it is not novelty.\n')
    return rows


def make_episode(rng, outside_contract=False):
    """Return a monitor-visible input and separate simulator-only truth."""
    true_target = rng.uniform(93.0, 107.0)
    true_age = rng.uniform(.10, .18) if outside_contract else rng.uniform(.02, .06)
    true_bias, true_noise, velocity = .4, rng.uniform(-.1, .1), 60.0
    z = true_target + velocity*true_age + true_bias + true_noise
    public = {'z_mm': z, 'velocity_mm_s': velocity, 'age_lo_s': .02,
              'age_hi_s': .06, 'bias_bound_mm': .6, 'noise_bound_mm': .1,
              'command_mm': 100.0, 'tolerance_mm': 3.0}
    hidden = {'true_target_mm': true_target, 'true_age_s': true_age,
              'true_bias_mm': true_bias, 'true_noise_mm': true_noise,
              'contract_violated': outside_contract}
    return public, hidden


def monitor(public, method):
    """No simulator truth is passed to any monitor."""
    if method == 'always_reject':
        return False
    if method == 'point_only':
        return abs(public['z_mm']-public['command_mm']) <= public['tolerance_mm']
    if method != 'bounded_interval':
        raise ValueError('Unknown monitor')
    possible = target_interval(public['z_mm'], public['velocity_mm_s'],
        public['age_lo_s'], public['age_hi_s'], public['bias_bound_mm'],
        public['noise_bound_mm'])
    return approves(possible, public['command_mm'], public['tolerance_mm'])


def evaluate(seed=7):
    rng = random.Random(seed)
    methods = ('point_only', 'bounded_interval', 'always_reject')
    summary, episodes = [], []
    for group, violated, count in (('within_declared_bounds', False, 200),
                                    ('wrong_age_bounds_stress', True, 100)):
        data = [make_episode(rng, violated) for _ in range(count)]
        for public, hidden in data:
            episodes.append({'group': group, 'public': public, 'evaluator_only': hidden})
        for method in methods:
            accepted = false_approvals = valid_rejections = valid = 0
            for public, hidden in data:
                actual_valid = abs(hidden['true_target_mm']-public['command_mm']) <= public['tolerance_mm']
                decision = monitor(public, method)
                valid += actual_valid
                accepted += decision
                false_approvals += decision and not actual_valid
                valid_rejections += not decision and actual_valid
            summary.append({'group': group, 'method': method, 'opportunities': count,
                'actually_valid': valid, 'approved': accepted,
                'false_approvals': false_approvals, 'valid_rejections': valid_rejections,
                'approval_fraction': accepted/count,
                'false_approvals_per_opportunity': false_approvals/count,
                'false_approvals_per_approval': false_approvals/accepted if accepted else None})
    print('LESSON 4: compare decisions and inspect bad assumptions')
    for row in summary:
        print('%-28s %-17s approved=%3d/%d; invalid approvals=%d; valid rejections=%d' % (
            row['group'], row['method'], row['approved'], row['opportunities'],
            row['false_approvals'], row['valid_rejections']))
    print('No approvals means the per-approval error rate is undefined, not zero.')
    print('These are synthetic decision outcomes, not physical pick success.\n')
    return {'seed': seed, 'summary': summary, 'episodes': episodes}


def self_check():
    assert math.isclose(60*30/1000, 1.8)
    lo, hi = target_interval(102, 60, .02, .06, .6, .1)
    assert math.isclose(lo, 97.7) and math.isclose(hi, 101.5)
    assert approves((lo, hi), 100, 3) and not approves((lo, hi), 100, 2)
    assert target_interval(10, 0, 0, 1, 2, 1) == (7, 13)
    assert target_interval(10, -2, 0, 1, 0, 0) == (10, 12)
    assert approves((97, 103), 100, 3)
    for args in ((1, 1, -.1, .2, 1, 1), (1, 1, .2, .1, 1, 1),
                 (1, 1, 0, 1, -1, 1), (float('nan'), 1, 0, 1, 1, 1)):
        try:
            target_interval(*args)
        except ValueError:
            pass
        else:
            raise AssertionError('Invalid input was accepted')
    print('Numerical checks passed: units, bounds, sign, threshold and invalid inputs.\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('lesson', nargs='?', default='all', choices=(
        'all', 'timing', 'interval', 'ambiguity', 'evaluate', 'self-check'))
    parser.add_argument('--output-dir', type=Path,
                        default=Path(__file__).resolve().parent/'generated')
    args = parser.parse_args()
    self_check()
    functions = {'timing': timing, 'interval': interval_lesson,
                 'ambiguity': ambiguity, 'evaluate': evaluate}
    results = {'synthetic_only': True, 'lessons': {}}
    chosen = functions if args.lesson == 'all' else {args.lesson: functions[args.lesson]} if args.lesson in functions else {}
    for name, function in chosen.items():
        results['lessons'][name] = function()
    if chosen:
        args.output_dir.mkdir(parents=True, exist_ok=True)
        output = args.output_dir/'foundation_results.json'
        output.write_text(json.dumps(results, indent=2)+'\n')
        print('Saved:', output)


if __name__ == '__main__':
    main()
