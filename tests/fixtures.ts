export const completedTournament = {
  tournament: {
    id: "qa-event",
    name: "QA Championship",
    venue: "Test Hall",
    organizer: "QA Arbiter",
    date: "2026-09-28",
    timeControl: "15+10",
    totalRounds: 1,
    type: "Swiss System",
    createdAt: "2026-09-28T00:00:00.000Z",
    finished: true,
  },
  players: [
    {
      id: "p1",
      name: "Alpha King",
      rating: 1900,
      age: 25,
      club: "North Club",
      country: "PHI",
      fideId: "1",
      ageCategory: "Open",
      active: true,
    },
    {
      id: "p2",
      name: "Beta Queen",
      rating: 1800,
      age: 22,
      club: "South Club",
      country: "JPN",
      fideId: "2",
      ageCategory: "Open",
      active: true,
    },
    {
      id: "p3",
      name: "Gamma Rook",
      rating: 1700,
      age: 17,
      club: "East Club",
      country: "NGR",
      fideId: "3",
      ageCategory: "U18",
      active: true,
    },
    {
      id: "p4",
      name: "Delta Bishop",
      rating: 1600,
      age: 15,
      club: "West Club",
      country: "USA",
      fideId: "4",
      ageCategory: "U16",
      active: true,
    },
  ],
  rounds: [
    {
      number: 1,
      locked: true,
      completed: true,
      createdAt: "2026-09-28T01:00:00.000Z",
      pairings: [
        {
          id: "g1",
          board: 1,
          whiteId: "p1",
          blackId: "p2",
          result: "1-0",
          locked: true,
        },
        {
          id: "g2",
          board: 2,
          whiteId: "p3",
          blackId: "p4",
          result: "½-½",
          locked: true,
        },
      ],
    },
  ],
  view: "dashboard",
};

export function libraryWithCompletedTournament() {
  return {
    version: 3,
    activeId: completedTournament.tournament.id,
    tournaments: { [completedTournament.tournament.id]: completedTournament },
    players: Object.fromEntries(
      completedTournament.players.map((player) => [player.id, player]),
    ),
  };
}
