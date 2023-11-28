import {
  ActionIcon,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Paper,
  Portal,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconArrowsExchange,
  IconPlus,
  IconZoomCheck,
} from "@tabler/icons-react";
import { Chess, DEFAULT_POSITION } from "chess.js";
import {
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { getNodeAtPath, treeIteratorMainLine } from "@/utils/treeReducer";
import GameInfo from "../common/GameInfo";
import MoveControls from "../common/MoveControls";
import {
  TreeDispatchContext,
  TreeStateContext,
} from "../common/TreeStateContext";
import Board from "./Board";
import GameNotation from "./GameNotation";
import {
  EngineSettings,
  activeTabAtom,
  currentGameStateAtom,
  currentPlayersAtom,
  enginesAtom,
  tabsAtom,
} from "@/atoms/atoms";
import { useAtom, useAtomValue } from "jotai";
import { match } from "ts-pattern";
import { parseUci } from "@/utils/chess";
import { Engine } from "@/utils/engines";
import { commands } from "@/bindings";
import { unwrap } from "@/utils/invoke";
import EngineSettingsForm from "../panels/analysis/EngineSettingsForm";

function EnginesSelect({
  engine,
  setEngine,
}: {
  engine: Engine | null;
  setEngine: (engine: Engine | null) => void;
}) {
  const engines = useAtomValue(enginesAtom);

  useEffect(() => {
    if (engines.length > 0 && engine === null) {
      setEngine(engines[0]);
    }
  }, [engine, engines, setEngine]);

  return (
    <Suspense>
      <Select
        label="Engine"
        data={engines!.map((engine) => ({
          label: engine.name,
          value: engine.path,
        }))}
        value={engine?.path ?? ""}
        onChange={(e) => {
          setEngine(engines.find((engine) => engine.path === e)!);
        }}
      />
    </Suspense>
  );
}

export type OpponentSettings =
  | {
      type: "human";
      name?: string;
    }
  | {
      type: "engine";
      engine: Engine | null;
      settings: EngineSettings;
    };

function OpponentForm({
  settings,
  setSettings,
}: {
  settings: OpponentSettings;
  setSettings: React.Dispatch<React.SetStateAction<OpponentSettings>>;
}) {
  function updateType(type: "engine" | "human") {
    if (type === "human") {
      setSettings({ type: "human", name: "Player" });
    } else {
      setSettings({
        type: "engine",
        engine: null,
        settings: {
          go: {
            t: "Time",
            c: 2000,
          },
          enabled: false,
          options: {
            threads: 2,
            multipv: 1,
            hash: 16,
            extraOptions: [],
          },
        },
      });
    }
  }

  return (
    <Stack sx={{ flex: 1 }}>
      <SegmentedControl
        data={[
          { value: "human", label: "Human" },
          { value: "engine", label: "Engine" },
        ]}
        value={settings.type}
        onChange={updateType}
      />

      {settings.type === "human" && (
        <TextInput
          label="Name"
          value={settings.name ?? ""}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, name: e.target.value }))
          }
        />
      )}

      {settings.type === "engine" && (
        <>
          <EnginesSelect
            engine={settings.engine}
            setEngine={(engine) => setSettings((prev) => ({ ...prev, engine }))}
          />

          <Stack>
            {settings.engine && (
              <EngineSettingsForm
                engine={settings.engine}
                settings={settings.settings}
                setSettings={(fn) =>
                  setSettings((prev) =>
                    prev.type === "human"
                      ? prev
                      : {
                          ...prev,
                          settings: fn(prev.settings),
                        }
                  )
                }
                minimal={true}
              />
            )}
          </Stack>
        </>
      )}
    </Stack>
  );
}

function BoardGame() {
  const activeTab = useAtomValue(activeTabAtom);

  const [inputColor, setInputColor] = useState<"white" | "random" | "black">(
    "white"
  );
  function cycleColor() {
    setInputColor((prev) =>
      match(prev)
        .with("white", () => "black" as const)
        .with("black", () => "random" as const)
        .with("random", () => "white" as const)
        .exhaustive()
    );
  }

  const [player1Settings, setPlayer1Settings] = useState<OpponentSettings>({
    type: "human",
    name: "Player",
  });
  const [player2Settings, setPlayer2Settings] = useState<OpponentSettings>({
    type: "human",
    name: "Player",
  });

  function getPlayers() {
    let white = inputColor === "white" ? player1Settings : player2Settings;
    let black = inputColor === "black" ? player1Settings : player2Settings;
    if (inputColor === "random") {
      white = Math.random() > 0.5 ? player1Settings : player2Settings;
      black = white === player1Settings ? player2Settings : player1Settings;
    }
    return { white, black };
  }

  const { headers, root, position } = useContext(TreeStateContext);
  const dispatch = useContext(TreeDispatchContext);
  const [, setTabs] = useAtom(tabsAtom);

  const boardRef = useRef(null);
  const [gameState, setGameState] = useAtom(currentGameStateAtom);

  function changeToAnalysisMode() {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.value === activeTab ? { ...tab, type: "analysis" } : tab
      )
    );
  }
  const mainLine = Array.from(treeIteratorMainLine(root));
  const currentNode = getNodeAtPath(root, position);
  const lastNode = mainLine[mainLine.length - 1].node;

  const chess = useMemo(() => new Chess(lastNode.fen), [lastNode.fen]);

  useEffect(() => {
    if (chess.isGameOver()) {
      setGameState("gameOver");
    }
  }, [lastNode.fen]);

  const [players, setPlayers] = useAtom(currentPlayersAtom);

  useEffect(() => {
    if (gameState === "playing") {
      const currentTurn = chess.turn();
      const player = currentTurn === "w" ? players.white : players.black;

      if (player.type === "engine" && player.engine) {
        commands
          .getSingleBestMove(
            player.settings.go,
            { ...player.settings.options, fen: lastNode.fen },
            player.engine.path
          )
          .then((move) => {
            dispatch({
              type: "APPEND_MOVE",
              payload: parseUci(unwrap(move)),
            });
          });
      }
    }
  }, [position, gameState, chess, players, lastNode.fen, dispatch]);

  const movable = useMemo(() => {
    if (players.white.type === "human" && players.black.type === "human") {
      return "turn";
    } else if (players.white.type === "human") {
      return "white";
    } else if (players.black.type === "human") {
      return "black";
    } else {
      return "none";
    }
  }, [players]);

  return (
    <>
      <Portal target="#left" style={{ height: "100%" }}>
        <Board
          dirty={false}
          currentNode={currentNode}
          arrows={[]}
          headers={headers}
          editingMode={false}
          toggleEditingMode={() => undefined}
          viewOnly={gameState !== "playing"}
          disableVariations
          boardRef={boardRef}
          movable={movable}
          root={root}
        />
      </Portal>
      <Portal target="#topRight" style={{ height: "100%", overflow: "hidden" }}>
        <Paper withBorder shadow="sm" p="md" h="100%">
          {gameState === "settingUp" && (
            <ScrollArea h="100%" offsetScrollbars>
              <Stack>
                <Group>
                  <Text sx={{ flex: 1 }} ta="center" fz="lg" fw="bold">
                    {match(inputColor)
                      .with("white", () => "White")
                      .with("random", () => "Random")
                      .with("black", () => "Black")
                      .exhaustive()}
                  </Text>
                  <ActionIcon onClick={cycleColor}>
                    <IconArrowsExchange />
                  </ActionIcon>
                  <Text sx={{ flex: 1 }} ta="center" fz="lg" fw="bold">
                    {match(inputColor)
                      .with("white", () => "Black")
                      .with("random", () => "Random")
                      .with("black", () => "White")
                      .exhaustive()}
                  </Text>
                </Group>
                <Box sx={{ flex: 1 }}>
                  <Group sx={{ alignItems: "start" }}>
                    <OpponentForm
                      settings={player1Settings}
                      setSettings={setPlayer1Settings}
                    />
                    <Divider orientation="vertical" />
                    <OpponentForm
                      settings={player2Settings}
                      setSettings={setPlayer2Settings}
                    />
                  </Group>
                </Box>

                <Center>
                  <Button
                    onClick={() => {
                      setGameState("playing");
                      const players = getPlayers();
                      setPlayers(players);
                      dispatch({
                        type: "SET_HEADERS",
                        payload: {
                          ...headers,
                          white:
                            (players.white.type === "human"
                              ? players.white.name
                              : players.white.engine?.name) ?? "?",
                          black:
                            (players.black.type === "human"
                              ? players.black.name
                              : players.black.engine?.name) ?? "?",
                        },
                      });
                    }}
                  >
                    Start game
                  </Button>
                </Center>
              </Stack>
            </ScrollArea>
          )}
          {(gameState === "playing" || gameState === "gameOver") && (
            <Stack h="100%">
              <Box sx={{ flex: 1 }}>
                <GameInfo headers={headers} />
              </Box>
              <Group grow>
                <Button
                  onClick={() => {
                    setGameState("settingUp");
                    dispatch({
                      type: "SET_FEN",
                      payload: DEFAULT_POSITION,
                    });
                    dispatch({
                      type: "SET_HEADERS",
                      payload: {
                        ...headers,
                        result: "*",
                      },
                    });
                  }}
                  leftIcon={<IconPlus />}
                >
                  New Game
                </Button>
                <Button
                  variant="default"
                  onClick={() => changeToAnalysisMode()}
                  leftIcon={<IconZoomCheck />}
                >
                  Analyze
                </Button>
              </Group>
            </Stack>
          )}
        </Paper>
      </Portal>
      <Portal target="#bottomRight" style={{ height: "100%" }}>
        <Stack h="100%">
          <GameNotation topBar />
          <MoveControls />
        </Stack>
      </Portal>
    </>
  );
}

export default BoardGame;
