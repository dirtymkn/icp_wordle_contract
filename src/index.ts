import {
  $query,
  $update,
  Record,
  StableBTreeMap,
  Vec,
  match,
  Result,
  nat8,
  ic,
  nat64,
} from "azle";
import { v4 as uuidv4 } from "uuid";
// list of words
import { wordList } from "./wordList";

// tries count to guess a word
let globTries: nat8 = -1;

// generated word based on needed length
let globWord: string | undefined = undefined;

// current game id to write a history
let currentHistoryId: string | undefined = undefined;

type historyItem = Record<{
  id: string;
  game_id: string;
  body: string;
  timestamp: nat64;
  format_date: string;
}>;

type GameHistoryElement = Record<{
  id: string;
  status: string;
  timestamp: nat64;
  format_date: string;
}>;

const historyStorage = new StableBTreeMap<string, GameHistoryElement>(
  2,
  44,
  1_000
);

const itemHistoryStorage = new StableBTreeMap<string, historyItem>(
  3,
  44,
  1_000
);

/**
 * Formats date from nanoseconds to string
 * @param nanoseconds first input to sum
 * @returns string
 */
const dateFormat = (nanoseconds: nat64): string => {
  return new Date(Number(nanoseconds / BigInt(1000000))).toString();
};

/**
 * Writes history after game starts
 * @returns void
 */
const startGameHistory = (): void => {
  const start_time: nat64 = ic.time();

  // add game to history games list
  const game: GameHistoryElement = {
    id: uuidv4(),
    status: "active",
    timestamp: start_time,
    format_date: dateFormat(start_time),
  };

  // add history item to specific game based on games's id
  const item: historyItem = {
    id: uuidv4(),
    game_id: game.id,
    body: `Game was started, word length: ${globWord?.length}, tries: ${globTries}`,
    timestamp: start_time,
    format_date: dateFormat(start_time),
  };

  currentHistoryId = game.id;

  historyStorage.insert(game.id, game);

  itemHistoryStorage.insert(item.id, item);
};

/**
 * Writes history to specific game
 * @param game_id
 * @param body history text
 * @returns void
 */
const writeToHistory = (game_id: string, body: string): void => {
  const timestamp: nat64 = ic.time();

  const item: historyItem = {
    id: uuidv4(),
    game_id,
    body,
    timestamp,
    format_date: dateFormat(timestamp),
  };

  itemHistoryStorage.insert(item.id, item);
};

/**
 * Gets all games from history
 * @returns List of games
 */
$query;
export function gamesHistoryList(): Result<Vec<GameHistoryElement>, string> {
  return Result.Ok(historyStorage.values());
}

/**
 * Removes all history
 * @returns void
 */
$update;
export function removeHistory(): void {
  historyStorage.values().forEach((e: GameHistoryElement) => {
    historyStorage.remove(e.id);
  });

  itemHistoryStorage.values().forEach((i: historyItem) => {
    itemHistoryStorage.remove(i.id);
  });
}

/**
 * Gets history on specific game
 * @param game_id
 * @returns List of history
 */
$query;
export function specificGameHistory(
  game_id: string
): Result<Vec<historyItem>, string> {
  const all_history: historyItem[] = itemHistoryStorage.values();
  const res: historyItem[] = all_history.filter(
    (h: historyItem) => h.game_id === game_id
  );

  return Result.Ok(res);
}

/**
 * Gets history on current game
 * @param game_id
 * @returns List of history if game was started
 */
$query;
export function currentGameHistory(): Result<Vec<historyItem>, string> {
  if (currentHistoryId) {
    const all_history: historyItem[] = itemHistoryStorage.values();
    const res: historyItem[] = all_history.filter(
      (h: historyItem) => h.game_id === currentHistoryId
    );

    return Result.Ok(res);
  }

  return Result.Err("Game is not started yet.");
}

/**
 * Params of imported word list, min and max length
 * @returns Object of params
 */
const wordListParams = (): { minLength: nat8; maxLength: nat8 } => {
  const map: number[] = wordList.map((w: string) => w.length);
  return { minLength: Math.min(...map), maxLength: Math.max(...map) };
};

const lengthMessage: string = `Select length of word from ${
  wordListParams().minLength
} to ${wordListParams().maxLength}`;

/**
 * Game rules with specified min and max word length
 * @returns string
 */
$query;
export function rules(): Result<string, string> {
  return Result.Ok(
    lengthMessage +
      "\n" +
      "Execute start function with needed word length and tries count"
  );
}

/**
 * Starts a game
 * @param wordLength
 * @param tries
 * @returns result
 */
$update;
export function start(wordLength: nat8, tries: nat8): Result<string, string> {
  if (
    wordLength >= wordListParams().minLength &&
    wordLength <= wordListParams().maxLength
  ) {
    if (tries > 0) {
      currentHistoryId = undefined;

      const tempWord: string = getRandomWord(wordLength);
      if (tempWord !== "") {
        globWord = tempWord;

        globTries = tries;

        const plural: string = tries === 1 ? "try" : "tries";

        startGameHistory();

        return Result.Ok(
          `Word with length ${wordLength} was generated, you have ${tries} ${plural}, ${tempWord} execute guess method next.`
        );
      }
      return Result.Err(`Word with length ${wordLength} cannot be generated.`);
    } else {
      return Result.Err("Tries count must be greater than zero.");
    }
  } else {
    return Result.Err(lengthMessage);
  }
}

/**
 * Information about tries left
 * @returns string
 */
$query;
export function triesLeft(): Result<string, string> {
  return Result.Ok(globTries > -1 ? String(globTries) : "Game is not started.");
}

/**
 * Processes user's guess
 * @param guess_word
 * @returns formatted message about guess
 */
$update;
export function guess(guess_word: string): Result<string, string> {
  if (globWord) {
    if (globTries > 0) {
      if (guess_word.length === globWord.length) {
        let result: string = "";

        [...guess_word].forEach((k: string, i: number) => {
          //@ts-ignore
          if (k === globWord[i]) {
            result += "+";
          } else if (globWord?.includes(k)) {
            result += "*";
          } else {
            result += "-";
          }
        });

        const formated_word: string = [...guess_word.toUpperCase()].join(" ");

        let formated_result: string = [...result].join(" ") + "\n";

        globTries -= 1;

        if (globWord === guess_word) {
          formated_result += "You won.";

          endGame();
        } else if (globTries === 0) {
          formated_result += `You lost, generated word was "${globWord}".`;

          endGame();
        }

        writeToHistory(
          // @ts-ignore
          currentHistoryId,
          `\n${formated_word}\n${formated_result}`
        );

        return Result.Ok(`\n${formated_word}\n${formated_result}`);
      } else {
        return Result.Err(`Word must be ${globWord.length} letters long.`);
      }
    } else {
      return Result.Err("You have no tries left, start again.");
    }
  } else {
    return Result.Err("Game was not started yet.");
  }
}

/**
 * Restores default values
 */
const endGame = (): void => {
  globWord = undefined;
  globTries = -1;

  if (currentHistoryId) {
    match(historyStorage.get(currentHistoryId), {
      Some: (element: GameHistoryElement) => {
        const updatedGame: GameHistoryElement = { ...element, status: "ended" };
        historyStorage.insert(updatedGame.id, updatedGame);
      },
      None: () => {},
    });
  }
};

/**
 * Gets random based on length
 * @param length
 * @returns string
 */
const getRandomWord = (length: nat8): string => {
  const words: string[] = wordList.filter((w: string) => w.length === length);
  return words[Math.floor(Math.random() * words.length - 1)];
};

// a workaround to make uuid package work with Azle
globalThis.crypto = {
  // @ts-ignore
  getRandomValues: () => {
    let array: Uint8Array = new Uint8Array(32);

    for (let i: number = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }

    return array;
  },
};
