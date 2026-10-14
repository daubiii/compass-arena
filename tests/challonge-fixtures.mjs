/* Фикстуры в формате Challonge API v1 (tournament → participants/matches с обёртками). */
export const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];
export function de8(played) {
  const parts = NAMES.map((name, i) => ({ participant: { id: 5000 + i + 1, name, seed: i + 1 } }));
  const P = (i) => 5000 + i;
  const mk = (id, round, order, extra) => ({ match: Object.assign({ id, round, suggested_play_order: order, state: 'pending',
    player1_id: null, player2_id: null, winner_id: null, scores_csv: '',
    player1_prereq_match_id: null, player2_prereq_match_id: null,
    player1_is_prereq_match_loser: false, player2_is_prereq_match_loser: false }, extra) });
  const ms = [
    mk(101, 1, 1, { state: 'complete', player1_id: P(1), player2_id: P(8), winner_id: P(1), scores_csv: '1-0,0-1,1-0' }),
    mk(102, 1, 2, { state: 'complete', player1_id: P(4), player2_id: P(5), winner_id: P(4), scores_csv: '2-0' }),
    mk(103, 1, 3, { state: 'open', player1_id: P(2), player2_id: P(7) }),
    mk(104, 1, 4, { player1_id: P(3), player2_id: P(6) }),
    mk(105, 2, 5, { player1_id: P(1), player2_id: P(4), player1_prereq_match_id: 101, player2_prereq_match_id: 102 }),
    mk(106, 2, 6, { player1_prereq_match_id: 103, player2_prereq_match_id: 104 }),
    mk(107, 3, 11, { player1_prereq_match_id: 105, player2_prereq_match_id: 106 }),
    mk(108, -1, 7, { player1_prereq_match_id: 101, player2_prereq_match_id: 102, player1_is_prereq_match_loser: true, player2_is_prereq_match_loser: true, player1_id: P(8), player2_id: P(5) }),
    mk(109, -1, 8, { player1_prereq_match_id: 103, player2_prereq_match_id: 104, player1_is_prereq_match_loser: true, player2_is_prereq_match_loser: true }),
    mk(110, -2, 9, { player1_prereq_match_id: 108, player2_prereq_match_id: 106, player2_is_prereq_match_loser: true }),
    mk(111, -2, 10, { player1_prereq_match_id: 109, player2_prereq_match_id: 105, player2_is_prereq_match_loser: true }),
    mk(112, -3, 12, { player1_prereq_match_id: 110, player2_prereq_match_id: 111 }),
    mk(113, -4, 13, { player1_prereq_match_id: 112, player2_prereq_match_id: 107, player2_is_prereq_match_loser: true }),
    mk(114, 4, 14, { player1_prereq_match_id: 107, player2_prereq_match_id: 113 }),
    mk(115, 5, 15, { player1_prereq_match_id: 114, player2_prereq_match_id: 114, player2_is_prereq_match_loser: true })
  ];
  return { tournament: { id: 77, name: 'Test Cup', tournament_type: 'double elimination', state: 'underway', participants: parts, matches: ms } };
}


/* Single elimination на 8 команд с матчем за 3-е место */
export function se8() {
  const parts = NAMES.map((name, i) => ({ participant: { id: 6000 + i + 1, name, seed: i + 1 } }));
  const P = (i) => 6000 + i;
  const mk = (id, round, order, extra) => ({ match: Object.assign({ id, round, suggested_play_order: order, state: 'pending',
    player1_id: null, player2_id: null, winner_id: null, scores_csv: '',
    player1_prereq_match_id: null, player2_prereq_match_id: null,
    player1_is_prereq_match_loser: false, player2_is_prereq_match_loser: false }, extra) });
  const ms = [
    mk(201, 1, 1, { state: 'complete', player1_id: P(1), player2_id: P(8), winner_id: P(1), scores_csv: '2-0' }),
    mk(202, 1, 2, { state: 'complete', player1_id: P(4), player2_id: P(5), winner_id: P(5), scores_csv: '1-2' }),
    mk(203, 1, 3, { state: 'complete', player1_id: P(2), player2_id: P(7), winner_id: P(2), scores_csv: '2-0' }),
    mk(204, 1, 4, { state: 'open', player1_id: P(3), player2_id: P(6) }),
    mk(205, 2, 5, { state: 'open', player1_id: P(1), player2_id: P(5), player1_prereq_match_id: 201, player2_prereq_match_id: 202 }),
    mk(206, 2, 6, { player1_id: P(2), player1_prereq_match_id: 203, player2_prereq_match_id: 204 }),
    mk(207, 3, 8, { player1_prereq_match_id: 205, player2_prereq_match_id: 206 }),
    mk(208, 3, 7, { player1_prereq_match_id: 205, player2_prereq_match_id: 206, player1_is_prereq_match_loser: true, player2_is_prereq_match_loser: true })
  ];
  return { tournament: { id: 88, name: 'Single Cup', tournament_type: 'single elimination', state: 'underway', participants: parts, matches: ms } };
}
