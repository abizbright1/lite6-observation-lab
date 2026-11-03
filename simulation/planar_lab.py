"""Seeded offline 2-D affine observation lab. Python 3.9+, standard library only.
No network, robot SDK, image renderer, dynamics, contact or physical safety claim.
"""
import argparse
import csv
import hashlib
import itertools
import json
import math
import random
from collections import defaultdict
from pathlib import Path

METHODS = ('current_measurement', 'age_compensated_point', 'bounded_interval')
DEFAULT = {
    'seed': 20261103, 'episodes_per_split': {'train': 12, 'calibration': 12, 'test': 40},
    'command_mm': [100.0, 100.0], 'tolerance_per_axis_mm': 3.0,
    'bias_bound_mm': 0.6, 'scale_bound_fraction': 0.002,
    'noise_bound_mm': 0.1, 'reference_bound_mm': 0.05,
    'clock_offset_nominal_s': 0.010, 'clock_offset_error_bound_s': 0.003,
    'clock_drift_bound_ppm': 25.0, 'max_age_s': 0.15,
    'decision_times_relative_s': [0.14, 0.20, 0.26],
    'actuation_error_bound_mm': 0.15, 'action_duration_s': 0.08,
}
SCENARIOS = [
    {'name': 'nominal_motion', 'in_contract': True, 'purpose': 'bounded delay, bias, scale, noise and constant camera translation'},
    {'name': 'stationary_null', 'in_contract': True, 'purpose': 'zero velocity: old pixels alone do not imply position error'},
    {'name': 'delay_jitter', 'in_contract': True, 'purpose': 'larger variable transport delay; same clock contract'},
    {'name': 'drop_duplicate_reorder', 'in_contract': True, 'purpose': 'loss, retransmission and out-of-order arrival; sequence guards'},
    {'name': 'clock_bounds_edge', 'in_contract': True, 'purpose': 'offset/drift near declared mapping bound'},
    {'name': 'calibration_bounds_edge', 'in_contract': True, 'purpose': 'bias/scale near declared support boundary'},
    {'name': 'observable_wrong_id', 'in_contract': True, 'purpose': 'reported marker ID differs: all methods reject it'},
    {'name': 'hidden_wrong_association', 'in_contract': False, 'purpose': 'wrong feature carries expected ID; no oracle detection'},
    {'name': 'wrong_clock_bounds', 'in_contract': False, 'purpose': 'actual clock mapping exceeds frozen bound'},
    {'name': 'wrong_calibration_bounds', 'in_contract': False, 'purpose': 'actual spatial bias exceeds frozen bound'},
    {'name': 'noise_outlier', 'in_contract': False, 'purpose': 'noise exceeds deterministic support'},
    {'name': 'unmodelled_acceleration', 'in_contract': False, 'purpose': 'constant-velocity observation model is violated'},
]


def interval_axis(z, velocity, age_lo, age_hi, bias_bound, scale_bound, noise_bound):
    """Exact single-frame axis hull of p=(z-b-n)/(1+s)-v*age.

    Denominator positive. Fixed-sign fractional derivative makes box extrema
    occur at corners. This is an INDEPENDENT box baseline, not correlated
    multi-frame joint inference and not an original algorithm.
    """
    values = (z, velocity, age_lo, age_hi, bias_bound, scale_bound, noise_bound)
    if not all(math.isfinite(x) for x in values):
        raise ValueError('Non-finite input')
    if not 0 <= age_lo <= age_hi or min(bias_bound, scale_bound, noise_bound) < 0 or scale_bound >= 1:
        raise ValueError('Invalid bounds')
    corners = [(z-b-n)/(1+s)-velocity*a for b, n, s, a in itertools.product(
        (-bias_bound, bias_bound), (-noise_bound, noise_bound),
        (-scale_bound, scale_bound), (age_lo, age_hi))]
    return min(corners), max(corners)


def stable_seed(seed, *parts):
    payload = ':'.join(map(str, (seed,)+parts)).encode()
    return int.from_bytes(hashlib.sha256(payload).digest()[:8], 'big')


def generate_episode(config, scenario, split, index):
    """Simulator and evaluator only. Monitors receive only public packet fields."""
    name = scenario['name']
    rng = random.Random(stable_seed(config['seed'], name, split, index))
    episode_id = hashlib.sha256(('%s:%s:%s:%s' % (config['seed'], name, split, index)).encode()).hexdigest()[:20]
    # Separate sessions partitioned by split; no adjacent frame split leakage.
    base = {'train': 1.0, 'calibration': 100.0, 'test': 200.0}[split] + index*0.5
    target = [100+rng.uniform(-6, 6), 100+rng.uniform(-6, 6)]
    velocity = [rng.choice((-120., -60., 0., 60., 120.)), rng.choice((-60., 0., 60.))]
    if name == 'stationary_null':
        velocity = [0., 0.]
    bias = [rng.uniform(-config['bias_bound_mm'], config['bias_bound_mm']) for _ in range(2)]
    scale = [rng.uniform(-config['scale_bound_fraction'], config['scale_bound_fraction']) for _ in range(2)]
    offset_error = rng.uniform(-config['clock_offset_error_bound_s'], config['clock_offset_error_bound_s'])
    drift = rng.uniform(-config['clock_drift_bound_ppm'], config['clock_drift_bound_ppm'])*1e-6
    if name == 'clock_bounds_edge':
        offset_error, drift = config['clock_offset_error_bound_s'], config['clock_drift_bound_ppm']*1e-6
    if name == 'calibration_bounds_edge':
        bias = [config['bias_bound_mm'], -config['bias_bound_mm']]
        scale = [config['scale_bound_fraction'], -config['scale_bound_fraction']]
    if name == 'wrong_clock_bounds':
        offset_error = -max(.050, config['clock_offset_error_bound_s']*10)
        drift = -max(300, config['clock_drift_bound_ppm']*10)*1e-6
    if name == 'wrong_calibration_bounds':
        bias = [max(4., config['bias_bound_mm']*5), -max(4., config['bias_bound_mm']*5)]
    tracking = [rng.uniform(-config['actuation_error_bound_mm'], config['actuation_error_bound_mm']) for _ in range(2)]
    reference = [target[j]+rng.uniform(-config['reference_bound_mm'], config['reference_bound_mm']) for j in range(2)]
    packets, truths = [], []
    for frame, relative_capture in enumerate((.00, .04, .08, .12, .18, .22)):
        capture = base+relative_capture
        delay = rng.uniform(.015, .050)
        if name in ('delay_jitter', 'drop_duplicate_reorder'):
            delay = rng.uniform(.015, .110)
        receive = capture+delay
        stamp = capture*(1+drift)+config['clock_offset_nominal_s']+offset_error
        noise = [rng.uniform(-config['noise_bound_mm'], config['noise_bound_mm']) for _ in range(2)]
        if name == 'noise_outlier' and frame % 2 == 0:
            noise = [max(3.5, config['noise_bound_mm']*10), -max(3.5, config['noise_bound_mm']*10)]
        observed_target = target[:]
        if name in ('hidden_wrong_association', 'observable_wrong_id'):
            observed_target = [target[0]+5.0, target[1]-5.0]
        # Static target p, translation r(c)=v*(c-origin):
        # raw=(p-r(c))*(1+scale)+bias+noise. Camera-local metric units.
        raw = [(observed_target[j]-velocity[j]*relative_capture)*(1+scale[j])+bias[j]+noise[j] for j in range(2)]
        if name == 'unmodelled_acceleration':
            raw = [raw[j]+1200*relative_capture**2*(1 if j == 0 else -1) for j in range(2)]
        packet = {'episode_id': episode_id, 'frame_id': frame, 'sequence_id': frame,
                  'host_receive_s': receive, 'camera_stamp_s': stamp,
                  'raw_x_mm': raw[0], 'raw_y_mm': raw[1],
                  'velocity_x_mm_s': velocity[0], 'velocity_y_mm_s': velocity[1],
                  'trajectory_origin_s': base,
                  'reported_target_id': 'distractor' if name == 'observable_wrong_id' else 'target_01'}
        truth = {'episode_id': episode_id, 'frame_id': frame, 'true_capture_s': capture,
                 'true_target_x_mm': target[0], 'true_target_y_mm': target[1],
                 'true_bias_x_mm': bias[0], 'true_bias_y_mm': bias[1],
                 'true_scale_x': scale[0], 'true_scale_y': scale[1],
                 'true_noise_x_mm': noise[0], 'true_noise_y_mm': noise[1],
                 'true_clock_offset_error_s': offset_error, 'true_clock_drift_ppm': drift*1e6,
                 'reference_x_mm': reference[0], 'reference_y_mm': reference[1],
                 'tracking_x_mm': tracking[0], 'tracking_y_mm': tracking[1],
                 'hidden_wrong_association': name == 'hidden_wrong_association',
                 'generator_contract_group': 'within' if scenario['in_contract'] else 'violated'}
        truths.append(truth)
        if name == 'drop_duplicate_reorder' and rng.random() < .25:
            continue
        packets.append(packet)
        if name == 'drop_duplicate_reorder' and frame % 2 == 0:
            duplicate = dict(packet)
            duplicate['host_receive_s'] += .055
            packets.append(duplicate)
    packets.sort(key=lambda x: (x['host_receive_s'], x['sequence_id']))
    return {'episode_id': episode_id, 'split': split, 'scenario': name, 'base_s': base,
            'packets': packets, 'truth': truths}


def observable_at(packet, decision_s, config):
    """Convert clock to an age enclosure and nominal capture/decision poses.

    Camera coordinate model: raw=(p-r(capture))*(1+s)+b+n.
    Since r(t)=v*(t-origin), p=raw/(1+s)-b/(1+s)-n/(1+s)+r(capture).
    Equivalently p=(z-b-n)/(1+s)-v*age, where
    z=raw+(1+s)*r(decision). To avoid hiding unknown s inside z, compute
    target intervals directly from raw and capture-position bounds below.
    """
    nominal_capture = packet['camera_stamp_s']-config['clock_offset_nominal_s']
    # Stamp error <= offset_bound + drift_bound*|capture|.
    # Use receipt as known upper bound on capture; causal delay is nonnegative.
    clock_radius = config['clock_offset_error_bound_s'] + config['clock_drift_bound_ppm']*1e-6*max(abs(packet['host_receive_s']), abs(nominal_capture))
    lo_capture = nominal_capture-clock_radius
    hi_capture = min(nominal_capture+clock_radius, packet['host_receive_s'])
    age_lo = max(0.0, decision_s-hi_capture)
    age_hi = decision_s-lo_capture
    result = dict(packet)
    result.update({'decision_s': decision_s, 'age_lo_s': age_lo, 'age_hi_s': age_hi,
                   'clock_consistent': hi_capture >= lo_capture and nominal_capture-clock_radius <= decision_s})
    # Apparent target is raw + current nominal pose. It intentionally ignores age.
    for axis in ('x', 'y'):
        result['z_%s_mm' % axis] = packet['raw_%s_mm' % axis] + packet['velocity_%s_mm_s' % axis]*(decision_s-packet['trajectory_origin_s'])
    return result


def target_axis(public, axis, config):
    # raw/(1+s) + v*(decision-origin-age) - (b+n)/(1+s).
    base = interval_axis(public['raw_%s_mm' % axis], public['velocity_%s_mm_s' % axis],
        public['age_lo_s'], public['age_hi_s'], config['bias_bound_mm'],
        config['scale_bound_fraction'], config['noise_bound_mm'])
    pose = public['velocity_%s_mm_s' % axis]*(public['decision_s']-public['trajectory_origin_s'])
    return base[0]+pose, base[1]+pose


def decide(public, method, config):
    """Only public observables and frozen config. No truth/scenario argument."""
    if public['reported_target_id'] != 'target_01':
        return False, 'reported_id_mismatch', None
    if not public['clock_consistent'] or public['age_hi_s'] < 0:
        return False, 'clock_inconsistent', None
    if public['age_hi_s'] > config['max_age_s']:
        return False, 'stale', None
    tol = config['tolerance_per_axis_mm']
    if method == 'bounded_interval':
        intervals = [target_axis(public, axis, config) for axis in ('x', 'y')]
        # Tracking bound covers the whole synthetic action; generator uses fixed
        # error during duration. No robot dynamics/contact model is claimed.
        radius = config['actuation_error_bound_mm']
        approved = all(max(abs(lo-q), abs(hi-q))+radius <= tol for (lo, hi), q in zip(intervals, config['command_mm']))
        return approved, 'contained' if approved else 'uncertainty_or_position', intervals
    if method == 'current_measurement':
        estimate = [public['z_%s_mm' % axis] for axis in ('x', 'y')]
    elif method == 'age_compensated_point':
        age = (public['age_lo_s']+public['age_hi_s'])/2
        estimate = [public['z_%s_mm' % axis]-public['velocity_%s_mm_s' % axis]*age for axis in ('x', 'y')]
    else:
        raise ValueError(method)
    approved = all(abs(x-q) <= tol for x, q in zip(estimate, config['command_mm']))
    return approved, 'point_within' if approved else 'point_outside', [(x, x) for x in estimate]


def run_method(episode, method, config):
    """Identical 3-decision, 260-ms observation horizon for all methods.

    First approval terminates; otherwise every method receives same packet stream
    and can wait/reobserve until deadline. No method gets private reacquisitions.
    """
    rows = []
    for attempt, dt in enumerate(config['decision_times_relative_s'], 1):
        decision_s = episode['base_s']+dt
        last_sequence, selected = -1, None
        for packet in episode['packets']:
            if packet['host_receive_s'] > decision_s:
                break
            if packet['sequence_id'] <= last_sequence:
                continue  # duplicate and out-of-order guard shared by every method
            last_sequence, selected = packet['sequence_id'], packet
        common = {'episode_id': episode['episode_id'], 'method': method, 'attempt': attempt,
                  'latency_s': dt, 'decision_s': decision_s, 'frame_id': '',
                  'approved': False, 'reason': 'no_frame', 'x_lo_mm': '', 'x_hi_mm': '', 'y_lo_mm': '', 'y_hi_mm': ''}
        public = None
        if selected:
            public = observable_at(selected, decision_s, config)
            approved, reason, intervals = decide(public, method, config)
            common.update({'frame_id': selected['frame_id'], 'approved': approved, 'reason': reason})
            if intervals:
                common.update({'x_lo_mm': intervals[0][0], 'x_hi_mm': intervals[0][1], 'y_lo_mm': intervals[1][0], 'y_hi_mm': intervals[1][1]})
        rows.append(common)
        if common['approved']:
            break
    return rows


def write_csv(path, rows):
    with path.open('w', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]) if rows else ['empty'])
        writer.writeheader()
        writer.writerows(rows)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_config(config):
    if set(config) != set(DEFAULT):
        raise ValueError('Config keys must match default_config.json')
    positive = ('tolerance_per_axis_mm', 'max_age_s', 'action_duration_s')
    nonnegative = ('bias_bound_mm', 'scale_bound_fraction', 'noise_bound_mm',
                   'reference_bound_mm', 'clock_offset_error_bound_s',
                   'clock_drift_bound_ppm', 'actuation_error_bound_mm')
    for key in positive + nonnegative:
        value = config[key]
        if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0 or (key in positive and value == 0):
            raise ValueError('Invalid ' + key)
    if config['scale_bound_fraction'] >= 1:
        raise ValueError('Scale bound must be less than 1')
    if len(config['command_mm']) != 2 or not all(math.isfinite(x) for x in config['command_mm']):
        raise ValueError('Command must have two finite coordinates')
    if not isinstance(config['seed'], int):
        raise ValueError('Seed must be an integer')
    if set(config['episodes_per_split']) != {'train', 'calibration', 'test'} or not all(isinstance(v, int) and v > 0 for v in config['episodes_per_split'].values()):
        raise ValueError('Need positive episode counts for all three splits')
    times = config['decision_times_relative_s']
    if not times or any(not math.isfinite(t) or t <= 0 for t in times) or any(a >= b for a,b in zip(times, times[1:])):
        raise ValueError('Decision times must be positive and strictly increasing')
    if not math.isfinite(config['clock_offset_nominal_s']):
        raise ValueError('Invalid nominal clock offset')


def run(config, output):
    validate_config(config)
    output.mkdir(parents=True, exist_ok=True)
    observations, truths, decisions, evaluation, summaries = [], [], [], [], []
    for scenario in SCENARIOS:
        for split, count in config['episodes_per_split'].items():
            stats = {method: defaultdict(float) for method in METHODS}
            for index in range(count):
                episode = generate_episode(config, scenario, split, index)
                # Strict packet whitelist: no scenario/split/fault labels exported.
                for packet in episode['packets']:
                    observations.append(dict(packet))
                for truth in episode['truth']:
                    truths.append({'split': split, 'scenario': scenario['name'], **truth})
                for method in METHODS:
                    result = run_method(episode, method, config)
                    decisions.extend(result)
                    final = result[-1]
                    truth = episode['truth'][int(final['frame_id'])] if final['frame_id'] != '' else episode['truth'][0]
                    actual_errors = [abs(truth['true_target_%s_mm' % a]-(q+truth['tracking_%s_mm' % a])) for a, q in zip(('x', 'y'), config['command_mm'])]
                    valid = max(actual_errors) <= config['tolerance_per_axis_mm']
                    reference_error = max(abs(truth['reference_%s_mm' % a]-q) for a, q in zip(('x', 'y'), config['command_mm']))
                    reference_radius = config['reference_bound_mm']+config['actuation_error_bound_mm']
                    reference_label = 'valid' if reference_error+reference_radius <= config['tolerance_per_axis_mm'] else 'invalid' if reference_error-reference_radius > config['tolerance_per_axis_mm'] else 'ambiguous'
                    coverage = None
                    if method == 'bounded_interval' and final['x_lo_mm'] != '':
                        coverage = all(final['%s_lo_mm' % a]-1e-9 <= truth['true_target_%s_mm' % a] <= final['%s_hi_mm' % a]+1e-9 for a in ('x', 'y'))
                    approved = final['approved']
                    evaluation.append({'episode_id': episode['episode_id'], 'split': split, 'scenario': scenario['name'], 'method': method,
                        'approved': approved, 'true_action_valid': valid, 'false_approval': approved and not valid,
                        'reference_label': reference_label, 'true_error_max_axis_mm': max(actual_errors),
                        'final_interval_contains_target': '' if coverage is None else coverage})
                    s = stats[method]
                    s['episodes'] += 1; s['approved'] += approved; s['false_approvals'] += approved and not valid
                    s['valid_rejections'] += not approved and valid; s['latency'] += final['latency_s']
                    s['reference_ambiguous'] += reference_label == 'ambiguous'
                    if coverage is not None:
                        s['coverage_n'] += 1; s['coverage_true'] += coverage
            for method, s in stats.items():
                summaries.append({'scenario': scenario['name'], 'contract_group': 'within' if scenario['in_contract'] else 'violated', 'split': split, 'method': method,
                    'episodes': int(s['episodes']), 'approved': int(s['approved']), 'false_approvals': int(s['false_approvals']),
                    'valid_rejections': int(s['valid_rejections']), 'approval_fraction': s['approved']/s['episodes'],
                    'false_approvals_per_approval': s['false_approvals']/s['approved'] if s['approved'] else None,
                    'false_approvals_per_opportunity': s['false_approvals']/s['episodes'],
                    'mean_decision_latency_s': s['latency']/s['episodes'],
                    'reference_ambiguous': int(s['reference_ambiguous']),
                    'interval_coverage_fraction': s['coverage_true']/s['coverage_n'] if s['coverage_n'] else None})
    write_csv(output/'observations.csv', observations)
    write_csv(output/'truth.csv', truths)
    write_csv(output/'decisions.csv', decisions)
    write_csv(output/'evaluation.csv', evaluation)
    summary = {'synthetic_only': True, 'seed': config['seed'], 'methods': list(METHODS),
        'assumptions': ['static target; local 2D affine scale plus bias; independent axes',
            'constant known camera translation per episode; correct trajectory origin',
            'all declared deterministic bounds hold only in within-contract scenarios',
            'same packets, metadata guards, decision times and horizon for every method',
            'fixed nominal command, per-axis square tolerance; no command optimization',
            'actuation error is bounded constant offset throughout configured synthetic action',
            'analytical configured supports; train/calibration splits do not fit bounds',
            'no full joint solver, physical safety, contact or grasp-success claim'],
        'scenario_matrix': SCENARIOS, 'results': summaries}
    (output/'summary.json').write_text(json.dumps(summary, indent=2)+'\n')
    (output/'config.json').write_text(json.dumps(config, indent=2)+'\n')
    manifest = {'files': {p.name: sha256(p) for p in sorted(output.iterdir()) if p.is_file() and p.name != 'manifest.json'},
        'generator_sha256': sha256(Path(__file__)), 'format': 1, 'synthetic_only': True}
    (output/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).parent/'generated')
    parser.add_argument('--seed', type=int)
    parser.add_argument('--config', type=Path, help='JSON overrides of DEFAULT; review bounds before use')
    args = parser.parse_args()
    config = dict(DEFAULT)
    if args.config:
        config.update(json.loads(args.config.read_text()))
    if args.seed is not None:
        config['seed'] = args.seed
    summary = run(config, args.output)
    print('SYNTHETIC ONLY. Wrote:', args.output.resolve())
    for r in summary['results']:
        if r['split'] == 'test':
            print('%-27s %-24s approved=%2d/%d false=%d latency=%.3fs' % (r['scenario'], r['method'], r['approved'], r['episodes'], r['false_approvals'], r['mean_decision_latency_s']))


if __name__ == '__main__':
    main()
