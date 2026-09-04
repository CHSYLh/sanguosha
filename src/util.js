function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const randInt = (n) => Math.floor(Math.random() * n);

const pickOne = (arr) => arr[randInt(arr.length)];

module.exports = { shuffle, sleep, randInt, pickOne };
