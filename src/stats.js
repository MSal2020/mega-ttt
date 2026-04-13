const STORAGE_KEY = "mega-ttt-stats";

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultStats();
  } catch {
    return defaultStats();
  }
}

function save(stats) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

function defaultStats() {
  return {
    local: { wins: 0, losses: 0, draws: 0, games: 0 },
    ai: { wins: 0, losses: 0, draws: 0, games: 0 },
    online: { wins: 0, losses: 0, draws: 0, games: 0 },
    history: [], // last 20 games: { mode, result, date, gridSize }
  };
}

export function getStats() {
  return load();
}

export function recordGame({ mode, result, gridSize }) {
  const stats = load();
  const bucket = stats[mode] || { wins: 0, losses: 0, draws: 0, games: 0 };
  bucket.games++;
  if (result === "win") bucket.wins++;
  else if (result === "loss") bucket.losses++;
  else if (result === "draw") bucket.draws++;
  stats[mode] = bucket;

  stats.history = [
    { mode, result, date: new Date().toISOString(), gridSize },
    ...(stats.history || []),
  ].slice(0, 20);

  save(stats);
  return stats;
}

export function clearStats() {
  save(defaultStats());
  return defaultStats();
}

export function getTotalGames(stats) {
  return (stats.local?.games || 0) + (stats.ai?.games || 0) + (stats.online?.games || 0);
}

export function getTotalWins(stats) {
  return (stats.local?.wins || 0) + (stats.ai?.wins || 0) + (stats.online?.wins || 0);
}

export function getWinRate(stats) {
  const total = getTotalGames(stats);
  if (total === 0) return 0;
  return Math.round((getTotalWins(stats) / total) * 100);
}
