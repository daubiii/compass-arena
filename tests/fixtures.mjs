/* Тестовые данные: те же поля, что пишет админка. */

export const TEAMS = [
  { id: 1, name: 'Team Spirit', players: [{ nick: 'Yatoro', role: 1 }, { nick: 'Larl', role: 2 }, { nick: 'Collapse', role: 3 }, { nick: 'Mira', role: 4 }, { nick: 'Miposhka', role: 5 }], logo: '' },
  { id: 2, name: 'Virtus.pro', players: ['Nightfall', 'gpk', 'Noticed', 'Save', 'Fng'], logo: '' },
  { id: 3, name: 'Team Liquid', players: ['m1CKe', 'Nisha', '33', 'Boxi', 'Insania'], logo: '' },
  { id: 4, name: 'OG', players: ['Yuragi', 'bzm', 'ATF', 'Taiga', 'Misha'], logo: '' },
  { id: 5, name: 'Gaimin Gladiators', players: ['dyrachyo', 'Quinn', 'Ace', 'tOfu', 'Seleri'], logo: '' },
  { id: 6, name: 'BetBoom Team', players: ['Pure', 'Nightfall', 'Save', 'TORONTOTOKYO', 'MieRo'], logo: '' }
];

export const M = (id, round, bracket, t1, t2, winner, s1, s2, vod) => ({
  id, round, bracket, team1: t1, team2: t2, winner, score1: s1, score2: s2, vod: vod || ''
});

export const PRE = {
  tournament: { name: 'Compass Arena', game: 'Dota 2', format: 'Custom Bracket', matches: 'Bo3', dates: '26 сентября 2030' },
  teams: TEAMS,
  matches: [M(1, 1, 'upper', 1, 2), M(2, 1, 'upper', 3, 4), M(3, 1, 'upper', 5, 6), M(4, 2, 'upper'), M(5, 3, 'grand')],
  schedule: {},
  liveMatchId: null,
  tournamentStart: '2030-09-26T12:00:00+03:00',
  projectStart: '2030-01-01T00:00:00+03:00',
  nextSeason: null,
  history: []
};

export const LIVE = {
  ...PRE,
  liveMatchId: 1,
  schedule: { 1: '2030-09-26T12:00', 2: '2030-09-26T15:00', 3: '2030-09-26T18:00' },
  matches: [M(1, 1, 'upper', 1, 2, null, 1, 0), M(2, 1, 'upper', 3, 4), M(3, 1, 'upper', 5, 6), M(4, 2, 'upper'), M(5, 3, 'grand')]
};

export const POST = {
  ...PRE,
  liveMatchId: null,
  schedule: {
    1: '2030-09-26T12:00', 2: '2030-09-26T15:00', 3: '2030-09-26T18:00',
    4: '2030-09-27T14:00', 5: '2030-09-27T18:00'
  },
  matches: [
    M(1, 1, 'upper', 1, 2, 1, 2, 1, 'https://www.twitch.tv/videos/1'),
    M(2, 1, 'upper', 3, 4, 3, 2, 0),
    M(3, 1, 'upper', 5, 6, 5, 2, 1),
    M(4, 2, 'upper', 1, 3, 1, 2, 0),
    M(5, 3, 'grand', 1, 5, 1, 2, 1, 'https://www.twitch.tv/videos/5')
  ],
  nextSeason: {
    name: 'Compass Arena · второй сезон',
    date: '2031-01-15T12:00:00+03:00',
    note: 'Восемь команд, сетка с нижней частью и полноценный призовой фонд. Заявки — в Telegram организации.',
    url: 'https://t.me/compassarenaa'
  },
  history: [
    {
      id: 'ca-2030-09-27-a', name: 'Compass Arena #1', date: '27.09.2030', createdAt: '2030-09-28T00:00:00Z',
      format: 'Custom Bracket · Bo3', game: 'Dota 2', teams: TEAMS,
      matches: [
        M(1, 1, 'upper', 1, 2, 1, 2, 1), M(2, 1, 'upper', 3, 4, 3, 2, 0),
        M(3, 1, 'upper', 5, 6, 5, 2, 1), M(4, 2, 'upper', 1, 3, 1, 2, 0),
        M(5, 3, 'grand', 1, 5, 1, 2, 1)
      ],
      championId: 1, runnerUpId: 5,
      mvp: { teamId: 1, playerNick: 'Yatoro', note: 'Лучший игрок гранд-финала: 4 игры на Morphling без поражений.' },
      photos: []
    },
    {
      id: 'ca-2029-05-12-b', name: 'Compass Arena · весенний кубок', date: '12.05.2029', createdAt: '2029-05-13T00:00:00Z',
      format: 'Double Elimination · Bo3', game: 'Dota 2', teams: TEAMS,
      matches: [
        M(1, 1, 'upper', 3, 4, 4, 1, 2), M(2, 1, 'upper', 1, 6, 6, 0, 2),
        M(3, 1, 'upper', 2, 5, 5, 2, 1), M(4, 2, 'upper', 4, 6, 6, 2, 0),
        M(5, 3, 'grand', 6, 5, 5, 2, 1)
      ],
      championId: 5, runnerUpId: 6,
      mvp: { teamId: 5, playerNick: 'Quinn', note: 'Самый стабильный мидер турнира.' },
      photos: []
    }
  ]
};

export const FIXTURES = { pre: PRE, live: LIVE, post: POST };
