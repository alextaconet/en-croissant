import {
  ActionIcon,
  Box,
  Card,
  createStyles,
  Group,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  Tooltip
} from "@mantine/core";
import {
  useHotkeys,
  useLocalStorage,
  useToggle,
  useViewportSize
} from "@mantine/hooks";
import { IconEdit, IconSwitchVertical } from "@tabler/icons-react";
import {
  BISHOP,
  Chess,
  KNIGHT,
  PieceSymbol,
  QUEEN,
  ROOK,
  Square
} from "chess.js";
import { Color } from "chessground/types";
import { useContext, useRef, useState } from "react";
import Chessground from "react-chessground";
import {
  formatMove,
  handleMove,
  moveToKey,
  parseUci,
  toDests
} from "../../utils/chess";
import { CompleteGame, Outcome as Result } from "../../utils/db";
import { formatScore } from "../../utils/format";
import Piece from "../common/Piece";
import TreeContext from "../common/TreeContext";

const useStyles = createStyles((theme) => ({
  chessboard: {
    position: "relative",
    marginRight: "auto",
    marginLeft: "auto",
    zIndex: 1,
  },
}));

interface ChessboardProps {
  arrows: string[];
  makeMove: (move: { from: Square; to: Square; promotion?: string }) => void;
  addPiece: (square: Square, piece: PieceSymbol, color: "w" | "b") => void;
  editingMode: boolean;
  toggleEditingMode: () => void;
  viewOnly?: boolean;
  disableVariations?: boolean;
  setCompleteGame: React.Dispatch<React.SetStateAction<CompleteGame>>;
  completeGame: CompleteGame;
  side?: Color;
}

const promotionPieces: PieceSymbol[] = [QUEEN, ROOK, KNIGHT, BISHOP];

function BoardPlay({
  arrows,
  makeMove,
  addPiece,
  editingMode,
  toggleEditingMode,
  viewOnly,
  disableVariations,
  setCompleteGame,
  completeGame,
  side,
}: ChessboardProps) {
  const tree = useContext(TreeContext);
  const chess = new Chess(tree.fen);
  if (chess.isCheckmate() && completeGame.game.result === Result.Unknown) {
    setCompleteGame((prev) => ({
      ...prev,
      game: {
        ...prev.game,
        result: chess.turn() === "w" ? Result.BlackWin : Result.WhiteWin,
      },
    }));
  }

  const lastMove = tree.move;
  const [showDests] = useLocalStorage<boolean>({
    key: "show-dests",
    defaultValue: true,
  });
  const [showArrows] = useLocalStorage<boolean>({
    key: "show-arrows",
    defaultValue: true,
  });
  const [autoPromote] = useLocalStorage<boolean>({
    key: "auto-promote",
    defaultValue: true,
  });
  const [forcedEP] = useLocalStorage<boolean>({
    key: "forced-en-passant",
    defaultValue: false,
  });
  const boardRef = useRef(null);
  const fen = chess.fen();
  const dests = toDests(chess, forcedEP);
  const turn = formatMove(chess.turn());
  const [pendingMove, setPendingMove] = useState<{
    from: Square;
    to: Square;
  } | null>(null);
  const [orientation, toggleOrientation] = useToggle<Color>(["white", "black"]);
  const { classes } = useStyles();
  const { height, width } = useViewportSize();

  function getBoardSize(height: number, width: number) {
    const initial = Math.min((height - 140) * 0.95, width * 0.4);
    if (width < 680) {
      return width - 120;
    }
    return initial;
  }
  const boardSize = getBoardSize(height, width);

  useHotkeys([["f", () => toggleOrientation()]]);

  const pieces = ["p", "n", "b", "r", "q", "k"] as const;
  const colors = ["w", "b"] as const;
  return (
    <Stack justify="center">
      {editingMode && (
        <Card shadow="md" style={{ overflow: "visible" }}>
          <SimpleGrid cols={6}>
            {colors.map((color) => {
              return pieces.map((piece) => {
                return (
                  <Piece
                    addPiece={addPiece}
                    boardRef={boardRef}
                    piece={piece}
                    color={color}
                  />
                );
              });
            })}
          </SimpleGrid>
        </Card>
      )}
      <Modal
        opened={pendingMove !== null}
        onClose={() => setPendingMove(null)}
        withCloseButton={false}
        size={375}
      >
        <SimpleGrid cols={2}>
          {promotionPieces.map((p) => (
            <ActionIcon
              key={p}
              sx={{ width: "100%", height: "100%", position: "relative" }}
              onClick={() => {
                makeMove({
                  from: pendingMove!.from,
                  to: pendingMove!.to,
                  promotion: p,
                });
                setPendingMove(null);
              }}
            >
              <Piece piece={p} color={turn === "white" ? "w" : "b"} />
            </ActionIcon>
          ))}
        </SimpleGrid>
      </Modal>

      <Box className={classes.chessboard} ref={boardRef}>
        <Chessground
          width={boardSize}
          height={boardSize}
          orientation={side ?? orientation}
          fen={fen}
          coordinates={false}
          movable={{
            free: editingMode,
            color: editingMode ? "both" : turn,
            dests:
              editingMode || viewOnly
                ? undefined
                : disableVariations && tree.children.length > 0
                ? undefined
                : dests,
            showDests,
            events: {
              after: (orig, dest, metadata) => {
                if (editingMode) {
                  makeMove({
                    from: orig as Square,
                    to: dest as Square,
                  });
                } else {
                  let newDest = handleMove(chess, orig, dest)!;
                  // handle promotions
                  if (
                    chess.get(orig as Square).type === "p" &&
                    ((newDest[1] === "8" && turn === "white") ||
                      (newDest[1] === "1" && turn === "black"))
                  ) {
                    if (autoPromote && !metadata.ctrlKey) {
                      makeMove({
                        from: orig as Square,
                        to: newDest,
                        promotion: QUEEN,
                      });
                    } else {
                      setPendingMove({ from: orig as Square, to: newDest });
                    }
                  } else {
                    makeMove({
                      from: orig as Square,
                      to: newDest,
                    });
                  }
                }
              },
            },
          }}
          turnColor={turn}
          check={chess.inCheck()}
          lastMove={moveToKey(lastMove)}
          drawable={{
            enabled: true,
            visible: true,
            defaultSnapToValidMove: true,
            eraseOnClick: true,
            autoShapes:
              showArrows && arrows.length > 0
                ? arrows.map((move, i) => {
                    const { from, to } = parseUci(move);
                    return {
                      orig: from,
                      dest: to,
                      brush: i === 0 ? "paleBlue" : "paleGrey",
                    };
                  })
                : [],
          }}
        />
      </Box>

      <Group position={"apart"} h={20}>
        {tree.score ? <Text>{formatScore(tree.score).text}</Text> : <div />}

        <Group>
          {!disableVariations && (
            <Tooltip label={"Edit Position"}>
              <ActionIcon onClick={() => toggleEditingMode()}>
                <IconEdit />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label={"Flip Board"}>
            <ActionIcon onClick={() => toggleOrientation()}>
              <IconSwitchVertical />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
    </Stack>
  );
}

export default BoardPlay;
