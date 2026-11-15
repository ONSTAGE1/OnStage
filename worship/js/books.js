/*
 * Bible book metadata.
 * `spoken` aliases are used by the AI listener (what a preacher actually says
 * and what speech recognisers commonly write). `typed` aliases are extra
 * abbreviations accepted only in the typed quick-search box.
 * All aliases are lower case with ordinals already converted to digits.
 */
(function (root) {
  var BOOKS = [
    ["Genesis", ["genesis"], ["gen", "gn", "ge"]],
    ["Exodus", ["exodus"], ["exod", "exo", "ex"]],
    ["Leviticus", ["leviticus"], ["lev", "lv"]],
    ["Numbers", ["numbers", "book of numbers"], ["num", "nm"]],
    ["Deuteronomy", ["deuteronomy", "deuteronomies", "duteronomy"], ["deut", "dt"]],
    ["Joshua", ["joshua"], ["josh", "jos"]],
    ["Judges", ["judges", "book of judges"], ["judg", "jdg"]],
    ["Ruth", ["ruth"], ["rth", "ru"]],
    ["1 Samuel", ["1 samuel"], ["1 sam", "1sam", "1sa", "1 sa"]],
    ["2 Samuel", ["2 samuel"], ["2 sam", "2sam", "2sa", "2 sa"]],
    ["1 Kings", ["1 kings"], ["1 kgs", "1kgs", "1ki", "1 ki"]],
    ["2 Kings", ["2 kings"], ["2 kgs", "2kgs", "2ki", "2 ki"]],
    ["1 Chronicles", ["1 chronicles"], ["1 chron", "1 chr", "1chr", "1ch"]],
    ["2 Chronicles", ["2 chronicles"], ["2 chron", "2 chr", "2chr", "2ch"]],
    ["Ezra", ["ezra"], ["ezr"]],
    ["Nehemiah", ["nehemiah"], ["neh", "ne"]],
    ["Esther", ["esther"], ["esth", "est"]],
    ["Job", ["job", "book of job"], ["jb"]],
    ["Psalms", ["psalms", "psalm", "psalter", "palm", "psalm number"], ["ps", "psa", "pss", "psm"]],
    ["Proverbs", ["proverbs", "proverb"], ["prov", "pro", "prv", "pr"]],
    ["Ecclesiastes", ["ecclesiastes", "ecclesiastics", "qoheleth"], ["eccl", "eccles", "ecc", "ec"]],
    ["Song of Solomon", ["song of solomon", "song of songs", "songs of solomon", "song of solomons"], ["song", "sos", "songs", "sng", "canticles"]],
    ["Isaiah", ["isaiah"], ["isa", "is"]],
    ["Jeremiah", ["jeremiah"], ["jer", "je"]],
    ["Lamentations", ["lamentations", "lamentation"], ["lam", "la"]],
    ["Ezekiel", ["ezekiel"], ["ezek", "eze", "ezk"]],
    ["Daniel", ["daniel"], ["dan", "da", "dn"]],
    ["Hosea", ["hosea"], ["hos", "ho"]],
    ["Joel", ["joel"], ["jl"]],
    ["Amos", ["amos"], ["am"]],
    ["Obadiah", ["obadiah"], ["obad", "ob"]],
    ["Jonah", ["jonah"], ["jon", "jnh"]],
    ["Micah", ["micah"], ["mic", "mc"]],
    ["Nahum", ["nahum"], ["nah", "na"]],
    ["Habakkuk", ["habakkuk", "habakuk", "habbakuk"], ["hab", "hb"]],
    ["Zephaniah", ["zephaniah"], ["zeph", "zep"]],
    ["Haggai", ["haggai"], ["hag", "hg"]],
    ["Zechariah", ["zechariah"], ["zech", "zec"]],
    ["Malachi", ["malachi"], ["mal", "ml"]],
    ["Matthew", ["matthew", "mathew"], ["matt", "mat", "mt"]],
    ["Mark", ["mark"], ["mrk", "mk", "mr"]],
    ["Luke", ["luke"], ["luk", "lk"]],
    ["John", ["john"], ["jn", "jhn", "joh"]],
    ["Acts", ["acts", "acts of the apostles", "book of acts"], ["act", "ac"]],
    ["Romans", ["romans"], ["rom", "ro", "rm"]],
    ["1 Corinthians", ["1 corinthians", "1 corinthian"], ["1 cor", "1cor", "1co", "1 co"]],
    ["2 Corinthians", ["2 corinthians", "2 corinthian"], ["2 cor", "2cor", "2co", "2 co"]],
    ["Galatians", ["galatians", "gallatians"], ["gal", "ga"]],
    ["Ephesians", ["ephesians"], ["eph", "ephes"]],
    ["Philippians", ["philippians", "phillipians", "philippines", "phillippians"], ["phil", "php", "pp"]],
    ["Colossians", ["colossians"], ["col", "co"]],
    ["1 Thessalonians", ["1 thessalonians"], ["1 thess", "1 thes", "1th", "1 th"]],
    ["2 Thessalonians", ["2 thessalonians"], ["2 thess", "2 thes", "2th", "2 th"]],
    ["1 Timothy", ["1 timothy"], ["1 tim", "1tim", "1ti", "1 ti"]],
    ["2 Timothy", ["2 timothy"], ["2 tim", "2tim", "2ti", "2 ti"]],
    ["Titus", ["titus"], ["tit", "ti"]],
    ["Philemon", ["philemon"], ["philem", "phm", "pm"]],
    ["Hebrews", ["hebrews"], ["heb"]],
    ["James", ["james"], ["jas", "jm"]],
    ["1 Peter", ["1 peter"], ["1 pet", "1pet", "1pe", "1 pe", "1pt"]],
    ["2 Peter", ["2 peter"], ["2 pet", "2pet", "2pe", "2 pe", "2pt"]],
    ["1 John", ["1 john"], ["1 jn", "1jn", "1jo", "1 jo"]],
    ["2 John", ["2 john"], ["2 jn", "2jn", "2jo", "2 jo"]],
    ["3 John", ["3 john"], ["3 jn", "3jn", "3jo", "3 jo"]],
    ["Jude", ["jude"], ["jud", "jd"]],
    ["Revelation", ["revelation", "revelations", "book of revelation", "revelation of jesus christ"], ["rev", "re", "rv", "apocalypse"]]
  ];

  var list = BOOKS.map(function (b, i) {
    return { index: i, name: b[0], spoken: b[1], typed: b[2], testament: i < 39 ? "OT" : "NT" };
  });

  var api = { list: list };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OnStageBooks = api;
})(this);
