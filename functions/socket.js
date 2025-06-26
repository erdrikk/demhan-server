const express = require("express")
const http = require("http")
const socketIo = require("socket.io")
const cors = require("cors")
const { v4: uuidv4 } = require("uuid")

const app = express()
const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: "https://demhan.vercel.app",
    methods: ["GET", "POST"],
  },
})

app.use(cors())
app.use(express.json())

// Game state
const rooms = new Map()
const players = new Map()

// Game modes
const GAME_MODES = {
  CLASSIC: "classic",
  TACTICAL: "tactical",
  RECYCLING: "recycling",
}

// Game mode configurations
const GAME_MODE_CONFIG = {
  [GAME_MODES.CLASSIC]: {
    startingHealth: 100,
    name: "Classic",
  },
  [GAME_MODES.TACTICAL]: {
    startingHealth: 100,
    name: "Tactical",
  },
  [GAME_MODES.RECYCLING]: {
    startingHealth: 150, // Increased HP for longer games
    name: "Recycling",
  },
}

// Game logic functions
function createDeck() {
  const suits = ["hearts", "diamonds", "clubs", "spades"]
  const deck = []

  for (const suit of suits) {
    for (let rank = 1; rank <= 13; rank++) {
      deck.push({
        id: `${suit}-${rank}-${Math.random()}`,
        suit,
        rank,
        selected: false,
        markedForDiscard: false,
      })
    }
  }

  // Shuffle deck
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }

  return deck
}

function validateHand(cards) {
  if (cards.length === 0) return { valid: false, error: "No cards selected" }

  const sortedCards = [...cards].sort((a, b) => a.rank - b.rank)
  const ranks = sortedCards.map((c) => c.rank)
  const suits = sortedCards.map((c) => c.suit)

  const rankCounts = {}
  ranks.forEach((rank) => {
    rankCounts[rank] = (rankCounts[rank] || 0) + 1
  })

  const counts = Object.values(rankCounts).sort((a, b) => b - a)
  const isFlush = suits.every((suit) => suit === suits[0]) && cards.length === 5

  // Fixed straight validation
  let isStraight = false
  let isLowStraight = false
  let isRoyal = false

  if (cards.length === 5 && new Set(ranks).size === 5) {
    // Check for low straight (A,2,3,4,5)
    isLowStraight = ranks.join(",") === "1,2,3,4,5"

    // Check for regular straight (consecutive ranks)
    if (!isLowStraight) {
      isStraight = ranks[4] - ranks[0] === 4
    }

    // Check for royal flush (A,10,J,Q,K) - note: this is the ONLY valid A-high straight
    isRoyal = isFlush && ranks.join(",") === "1,10,11,12,13"
  }

  switch (cards.length) {
    case 1:
      return { valid: true }
    case 2:
      if (counts[0] !== 2) {
        return { valid: false, error: "Two cards must be a pair (same rank)" }
      }
      return { valid: true }
    case 3:
      if (counts[0] !== 3) {
        return { valid: false, error: "Three cards must be three of a kind (same rank)" }
      }
      return { valid: true }
    case 4:
      if (counts[0] === 4) {
        return { valid: true }
      }
      if (counts[0] === 2 && counts[1] === 2) {
        return { valid: true }
      }
      return {
        valid: false,
        error: "Four cards must be either four of a kind or two pair",
      }
    case 5:
      if (isRoyal) return { valid: true }
      if (isFlush && (isStraight || isLowStraight)) return { valid: true }
      if (counts[0] === 3 && counts[1] === 2) return { valid: true }
      if (isFlush) return { valid: true }
      if (isStraight || isLowStraight) return { valid: true }
      return { valid: false, error: "5 cards must form: Straight, Flush, Full House, Straight Flush, or Royal Flush" }
    default:
      return { valid: false, error: `Invalid number of cards: ${cards.length}. Play 1, 2, 3, 4, or 5 cards only.` }
  }
}

function evaluateHand(cards) {
  const HAND_RANKINGS = {
    "Royal Flush": { damage: 50, description: "A, K, Q, J, 10 of same suit" },
    "Straight Flush": { damage: 40, description: "5 consecutive cards of same suit" },
    "Four of a Kind": { damage: 35, description: "4 cards of same rank" },
    "Full House": { damage: 30, description: "3 of a kind + pair" },
    Flush: { damage: 25, description: "5 cards of same suit" },
    Straight: { damage: 20, description: "5 consecutive cards" },
    "Three of a Kind": { damage: 15, description: "3 cards of same rank" },
    "Two Pair": { damage: 10, description: "2 pairs of different ranks" },
    "One Pair": { damage: 5, description: "2 cards of same rank" },
    "High Card": { damage: 1, description: "Highest card" },
  }

  if (cards.length === 0) return { type: "No Cards", damage: 0, description: "No cards selected" }

  const validation = validateHand(cards)
  if (!validation.valid) {
    return { type: "Invalid Hand", damage: 0, description: validation.error || "Invalid combination" }
  }

  const sortedCards = [...cards].sort((a, b) => a.rank - b.rank)
  const ranks = sortedCards.map((c) => c.rank)
  const suits = sortedCards.map((c) => c.suit)

  // Calculate face value damage
  const faceValueDamage = cards.reduce((total, card) => {
    if (card.rank === 1) return total + 14
    if (card.rank === 13) return total + 13
    if (card.rank === 12) return total + 12
    if (card.rank === 11) return total + 11
    return total + card.rank
  }, 0)

  const rankCounts = {}
  ranks.forEach((rank) => {
    rankCounts[rank] = (rankCounts[rank] || 0) + 1
  })

  const counts = Object.values(rankCounts).sort((a, b) => b - a)
  const isFlush = suits.every((suit) => suit === suits[0]) && cards.length === 5

  // Fixed straight evaluation
  let isStraight = false
  let isLowStraight = false
  let isRoyal = false

  if (cards.length === 5 && new Set(ranks).size === 5) {
    isLowStraight = ranks.join(",") === "1,2,3,4,5"
    if (!isLowStraight) {
      isStraight = ranks[4] - ranks[0] === 4
    }
    isRoyal = isFlush && ranks.join(",") === "1,10,11,12,13"
  }

  let handType = ""
  let baseDamage = 0

  if (isRoyal) {
    handType = "Royal Flush"
    baseDamage = HAND_RANKINGS["Royal Flush"].damage
  } else if (isFlush && (isStraight || isLowStraight)) {
    handType = "Straight Flush"
    baseDamage = HAND_RANKINGS["Straight Flush"].damage
  } else if (counts[0] === 4) {
    handType = "Four of a Kind"
    baseDamage = HAND_RANKINGS["Four of a Kind"].damage
  } else if (counts[0] === 3 && counts[1] === 2) {
    handType = "Full House"
    baseDamage = HAND_RANKINGS["Full House"].damage
  } else if (isFlush) {
    handType = "Flush"
    baseDamage = HAND_RANKINGS["Flush"].damage
  } else if (isStraight || isLowStraight) {
    handType = "Straight"
    baseDamage = HAND_RANKINGS["Straight"].damage
  } else if (counts[0] === 3) {
    handType = "Three of a Kind"
    baseDamage = HAND_RANKINGS["Three of a Kind"].damage
  } else if (counts[0] === 2 && counts[1] === 2) {
    handType = "Two Pair"
    baseDamage = HAND_RANKINGS["Two Pair"].damage
  } else if (counts[0] === 2) {
    handType = "One Pair"
    baseDamage = HAND_RANKINGS["One Pair"].damage
  } else {
    handType = "High Card"
    baseDamage = HAND_RANKINGS["High Card"].damage
  }

  const totalDamage = baseDamage + faceValueDamage

  return {
    type: handType,
    damage: totalDamage,
    description: `${HAND_RANKINGS[handType].description} (Base: ${baseDamage} + Face: ${faceValueDamage})`,
  }
}

// Start game function
function startGame(roomId) {
  const room = rooms.get(roomId)
  if (!room || room.players.length !== 2) {
    console.log("❌ Cannot start game - invalid room or not enough players")
    return
  }

  console.log(`🎮 Starting ${room.gameMode} game in room ${roomId}`)

  const deck = createDeck()
  const gameConfig = GAME_MODE_CONFIG[room.gameMode] || GAME_MODE_CONFIG[GAME_MODES.CLASSIC]

  // Initialize players with game data based on game mode
  room.players.forEach((player, index) => {
    player.health = gameConfig.startingHealth
    player.maxHealth = gameConfig.startingHealth
    player.hand = deck.slice(index * 8, (index + 1) * 8)
    player.selectedCards = []

    // Updated discard limits: 3 total discards per game, max 3 cards per discard
    player.discardsUsed = 0
    player.maxDiscards = 3
    player.maxCardsPerDiscard = 3

    // Tactical mode specific - initialize for ALL players in tactical mode
    if (room.gameMode === GAME_MODES.TACTICAL) {
      player.armor = 0
      player.prediction = null
      player.parryCards = []
    }

    console.log(`🎯 Player ${player.name} initialized: HP=${player.health}, Mode=${room.gameMode}`)
  })

  room.gameState = "playing"
  room.currentPlayer = Math.floor(Math.random() * 2)
  console.log(`🎲 ${room.players[room.currentPlayer].name} goes first!`)
  room.turn = 1
  room.deck = deck.slice(16)

  // Recycling mode specific
  if (room.gameMode === GAME_MODES.RECYCLING) {
    room.discardPile = []
  }

  console.log("✅ Game started, emitting to room:", roomId)

  const gameData = {
    room: {
      ...room,
      gameMode: room.gameMode, // Ensure game mode is included
    },
  }

  io.to(roomId).emit("gameStarted", gameData)

  room.players.forEach((player) => {
    io.to(player.id).emit("gameStarted", gameData)
    console.log(`📤 Sent gameStarted to player ${player.name} (${player.id}) with mode ${room.gameMode}`)
  })

  console.log("🎯 Game initialization complete")
}

// Socket.IO connection handling
io.on("connection", (socket) => {
  console.log("User connected:", socket.id)

  socket.on("setPlayerName", (name) => {
    players.set(socket.id, { id: socket.id, name, roomId: null })
    socket.emit("playerSet", { id: socket.id, name })
    console.log(`Player ${name} (${socket.id}) set name`)
  })

  socket.on("getRooms", () => {
    const availableRooms = Array.from(rooms.values())
      .filter((room) => room.players.length < 2)
      .map((room) => ({
        id: room.id,
        name: room.name,
        players: room.players.length,
        maxPlayers: 2,
        gameMode: room.gameMode,
      }))
    socket.emit("roomsList", availableRooms)
  })

  socket.on("createRoom", ({ roomName, gameMode = GAME_MODES.CLASSIC }) => {
    const roomId = uuidv4()
    const player = players.get(socket.id)

    if (!player) {
      socket.emit("error", "Player not found")
      return
    }

    const room = {
      id: roomId,
      name: roomName,
      gameMode: gameMode,
      players: [player],
      gameState: "waiting",
      currentPlayer: 0,
      turn: 1,
      deck: [],
      lastPlayedHand: null,
    }

    rooms.set(roomId, room)
    player.roomId = roomId

    socket.join(roomId)
    socket.emit("roomCreated", { roomId, room })
    io.emit("roomsUpdated")

    console.log(`Room ${roomName} (${roomId}) created by ${player.name} - Mode: ${gameMode}`)
  })

  socket.on("joinRoom", (roomId) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room) {
      socket.emit("error", "Room not found")
      return
    }

    if (!player) {
      socket.emit("error", "Player not found")
      return
    }

    if (room.players.length >= 2) {
      socket.emit("error", "Room is full")
      return
    }

    if (room.players.find((p) => p.id === socket.id)) {
      socket.emit("error", "You are already in this room")
      return
    }

    room.players.push(player)
    player.roomId = roomId

    socket.join(roomId)
    console.log(`👥 Player ${player.name} joined room ${room.name} (${room.players.length}/2) - Mode: ${room.gameMode}`)

    // Send room data with game mode to all players
    io.to(roomId).emit("playerJoined", {
      player,
      room: {
        ...room,
        gameMode: room.gameMode, // Ensure game mode is included
      },
    })
    io.emit("roomsUpdated")

    if (room.players.length === 2) {
      console.log("🎯 Room full, starting game in 2 seconds...")
      setTimeout(() => {
        startGame(roomId)
      }, 2000)
    }
  })

  socket.on("selectCard", ({ roomId, cardId }) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room || !player || room.gameState !== "playing") return

    const playerIndex = room.players.findIndex((p) => p.id === socket.id)
    if (playerIndex !== room.currentPlayer) return

    const currentPlayer = room.players[playerIndex]
    const card = currentPlayer.hand.find((c) => c.id === cardId)

    if (card) {
      card.selected = !card.selected
      currentPlayer.selectedCards = currentPlayer.hand.filter((c) => c.selected)

      io.to(roomId).emit("cardSelected", { playerIndex, cardId, selected: card.selected })
    }
  })

  socket.on("markForDiscard", ({ roomId, cardId }) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room || !player || room.gameState !== "playing") return

    const playerIndex = room.players.findIndex((p) => p.id === socket.id)
    if (playerIndex !== room.currentPlayer) return

    const currentPlayer = room.players[playerIndex]
    const card = currentPlayer.hand.find((c) => c.id === cardId)

    if (card) {
      card.markedForDiscard = !card.markedForDiscard
      io.to(roomId).emit("cardMarkedForDiscard", { playerIndex, cardId, marked: card.markedForDiscard })
    }
  })

  socket.on("discardCards", ({ roomId }) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room || !player || room.gameState !== "playing") return

    const playerIndex = room.players.findIndex((p) => p.id === socket.id)
    if (playerIndex !== room.currentPlayer) return

    const currentPlayer = room.players[playerIndex]
    const markedCards = currentPlayer.hand.filter((c) => c.markedForDiscard)

    // Updated limits: max 3 cards per discard, 3 total discards per game
    if (
      markedCards.length === 0 ||
      markedCards.length > currentPlayer.maxCardsPerDiscard ||
      currentPlayer.discardsUsed >= currentPlayer.maxDiscards
    )
      return

    console.log(`🗑️ Player ${currentPlayer.name} discarding ${markedCards.length} cards`)

    // Remove marked cards
    currentPlayer.hand = currentPlayer.hand.filter((c) => !c.markedForDiscard)

    if (room.gameMode === GAME_MODES.RECYCLING) {
      // In recycling mode, add discarded cards to discard pile
      room.discardPile.push(
        ...markedCards.map((card) => ({
          ...card,
          selected: false,
          markedForDiscard: false,
        })),
      )
    }

    const newCards = room.deck.splice(0, markedCards.length).map((card) => ({
      ...card,
      selected: false,
      markedForDiscard: false,
    }))

    currentPlayer.hand.push(...newCards)
    currentPlayer.discardsUsed++

    console.log(`✅ Player ${currentPlayer.name} now has ${currentPlayer.hand.length} cards`)

    io.to(roomId).emit("gameStateUpdate", {
      players: room.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        health: p.health,
        maxHealth: p.maxHealth,
        handSize: p.hand.length,
        discardsUsed: p.discardsUsed,
        maxDiscards: p.maxDiscards,
        maxCardsPerDiscard: p.maxCardsPerDiscard,
        ...(room.gameMode === GAME_MODES.TACTICAL ? { armor: p.armor } : {}),
        ...(idx === playerIndex ? { hand: p.hand } : {}),
      })),
    })
  })

  // Tactical mode: Prediction system
  socket.on("makePrediction", ({ roomId, prediction }) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room || !player || room.gameMode !== GAME_MODES.TACTICAL) return

    const playerIndex = room.players.findIndex((p) => p.id === socket.id)
    const currentPlayer = room.players[playerIndex]

    // Allow prediction only when it's NOT your turn (you can't predict your own hand)
    if (playerIndex === room.currentPlayer) {
      socket.emit("error", "You cannot predict your own hand")
      return
    }

    currentPlayer.prediction = prediction

    console.log(`🔮 ${currentPlayer.name} predicted: ${prediction}`)

    // Broadcast to all players in the room
    io.to(roomId).emit("predictionMade", { playerIndex, prediction })
  })

  socket.on("playHand", ({ roomId }) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room || !player || room.gameState !== "playing") return

    const playerIndex = room.players.findIndex((p) => p.id === socket.id)
    if (playerIndex !== room.currentPlayer) return

    const currentPlayer = room.players[playerIndex]
    const enemyPlayer = room.players[1 - playerIndex]

    if (currentPlayer.selectedCards.length === 0) return

    const validation = validateHand(currentPlayer.selectedCards)
    if (!validation.valid) {
      socket.emit("invalidHand", validation.error)
      return
    }

    const handResult = evaluateHand(currentPlayer.selectedCards)
    let finalDamage = handResult.damage

    // Tactical mode: Check prediction
    if (room.gameMode === GAME_MODES.TACTICAL && enemyPlayer.prediction) {
      console.log(`🎯 Checking prediction: ${enemyPlayer.prediction} vs actual: ${handResult.type}`)

      if (enemyPlayer.prediction === handResult.type) {
        finalDamage = Math.floor(finalDamage * 0.25) // 75% damage reduction
        console.log(
          `✅ ${enemyPlayer.name} correctly predicted ${handResult.type}! Damage reduced from ${handResult.damage} to ${finalDamage}`,
        )
      } else {
        finalDamage = Math.floor(finalDamage * 1.25) // 25% extra damage
        console.log(
          `❌ ${enemyPlayer.name} incorrectly predicted ${enemyPlayer.prediction}, actual was ${handResult.type}. Damage increased from ${handResult.damage} to ${finalDamage}`,
        )
      }

      // Reset prediction after use
      enemyPlayer.prediction = null
    }

    // Tactical mode: Apply armor
    if (room.gameMode === GAME_MODES.TACTICAL && enemyPlayer.armor > 0) {
      const armorAbsorbed = Math.min(enemyPlayer.armor, finalDamage)
      enemyPlayer.armor -= armorAbsorbed
      finalDamage -= armorAbsorbed
      console.log(
        `🛡️ ${enemyPlayer.name}'s armor absorbed ${armorAbsorbed} damage. Remaining armor: ${enemyPlayer.armor}, Final damage: ${finalDamage}`,
      )
    }

    // Deal damage to enemy
    enemyPlayer.health = Math.max(0, enemyPlayer.health - finalDamage)

    // Handle played cards based on game mode
    const playedCards = currentPlayer.hand.filter((c) => c.selected)
    currentPlayer.hand = currentPlayer.hand.filter((c) => !c.selected)
    currentPlayer.selectedCards = []

    if (room.gameMode === GAME_MODES.RECYCLING) {
      // Add played cards to discard pile
      room.discardPile.push(
        ...playedCards.map((card) => ({
          ...card,
          selected: false,
          markedForDiscard: false,
        })),
      )

      // If deck is low, shuffle discard pile back in
      if (room.deck.length < 8 && room.discardPile.length > 0) {
        console.log(`♻️ Shuffling ${room.discardPile.length} cards back into deck`)

        // Shuffle discard pile
        for (let i = room.discardPile.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[room.discardPile[i], room.discardPile[j]] = [room.discardPile[j], room.discardPile[i]]
        }

        // Add to bottom of deck
        room.deck.push(...room.discardPile)
        room.discardPile = []
      }
    }

    // Draw NEW 8 cards (replace entire hand)
    const newCards = room.deck.splice(0, 8).map((card) => ({
      ...card,
      selected: false,
      markedForDiscard: false,
    }))

    currentPlayer.hand = newCards

    room.lastPlayedHand = { ...handResult, damage: finalDamage }

    // Check for game over
    if (enemyPlayer.health <= 0) {
      room.gameState = "ended"
      io.to(roomId).emit("gameEnded", { winner: currentPlayer, handResult: room.lastPlayedHand })
      return
    }

    // Switch turns
    room.currentPlayer = 1 - room.currentPlayer
    room.turn++

    // Reset discards for new player
    room.players[room.currentPlayer].discardsUsed = 0

    io.to(roomId).emit("handPlayed", {
      playerIndex,
      handResult: room.lastPlayedHand,
      newCurrentPlayer: room.currentPlayer,
      turn: room.turn,
      players: room.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        health: p.health,
        maxHealth: p.maxHealth,
        handSize: p.hand.length,
        discardsUsed: p.discardsUsed,
        maxDiscards: p.maxDiscards,
        maxCardsPerDiscard: p.maxCardsPerDiscard,
        ...(room.gameMode === GAME_MODES.TACTICAL ? { armor: p.armor, prediction: p.prediction } : {}),
        ...(idx === playerIndex ? { hand: p.hand } : {}),
      })),
    })
  })

  // Tactical mode: Build armor
  socket.on("buildArmor", ({ roomId }) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room || !player || room.gameMode !== GAME_MODES.TACTICAL || room.gameState !== "playing") return

    const playerIndex = room.players.findIndex((p) => p.id === socket.id)

    // Only allow armor building on your turn
    if (playerIndex !== room.currentPlayer) {
      socket.emit("error", "You can only build armor on your turn")
      return
    }

    const currentPlayer = room.players[playerIndex]

    if (currentPlayer.selectedCards.length === 0) {
      socket.emit("error", "No cards selected")
      return
    }

    const validation = validateHand(currentPlayer.selectedCards)
    if (!validation.valid) {
      socket.emit("invalidHand", validation.error)
      return
    }

    // Calculate armor based on hand type
    let armorGained = 0
    const handResult = evaluateHand(currentPlayer.selectedCards)

    switch (handResult.type) {
      case "High Card":
        armorGained = 2
        break
      case "One Pair":
        armorGained = 5
        break
      case "Two Pair":
        armorGained = 8
        break
      case "Three of a Kind":
        armorGained = 12
        break
      case "Straight":
        armorGained = 15
        break
      case "Flush":
        armorGained = 18
        break
      case "Full House":
        armorGained = 22
        break
      case "Four of a Kind":
        armorGained = 25
        break
      case "Straight Flush":
        armorGained = 30
        break
      case "Royal Flush":
        armorGained = 35
        break
      default:
        armorGained = 2
        break
    }

    const oldArmor = currentPlayer.armor
    currentPlayer.armor = Math.min(50, currentPlayer.armor + armorGained) // Max 50 armor
    const actualArmorGained = currentPlayer.armor - oldArmor

    console.log(
      `🛡️ ${currentPlayer.name} built ${actualArmorGained} armor with ${handResult.type} (Total: ${currentPlayer.armor}/50)`,
    )

    // Handle played cards based on game mode
    const playedCards = currentPlayer.hand.filter((c) => c.selected)
    currentPlayer.hand = currentPlayer.hand.filter((c) => !c.selected)
    currentPlayer.selectedCards = []

    if (room.gameMode === GAME_MODES.RECYCLING) {
      room.discardPile.push(
        ...playedCards.map((card) => ({
          ...card,
          selected: false,
          markedForDiscard: false,
        })),
      )

      if (room.deck.length < 8 && room.discardPile.length > 0) {
        console.log(`♻️ Shuffling ${room.discardPile.length} cards back into deck`)
        for (let i = room.discardPile.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[room.discardPile[i], room.discardPile[j]] = [room.discardPile[j], room.discardPile[i]]
        }
        room.deck.push(...room.discardPile)
        room.discardPile = []
      }
    }

    const newCards = room.deck.splice(0, 8).map((card) => ({
      ...card,
      selected: false,
      markedForDiscard: false,
    }))

    currentPlayer.hand = newCards

    // Switch turns
    room.currentPlayer = 1 - room.currentPlayer
    room.turn++
    room.players[room.currentPlayer].discardsUsed = 0

    io.to(roomId).emit("armorBuilt", {
      playerIndex,
      armorGained: actualArmorGained,
      handResult,
      newCurrentPlayer: room.currentPlayer,
      turn: room.turn,
      players: room.players.map((p, idx) => ({
        id: p.id,
        name: p.name,
        health: p.health,
        maxHealth: p.maxHealth,
        handSize: p.hand.length,
        discardsUsed: p.discardsUsed,
        maxDiscards: p.maxDiscards,
        maxCardsPerDiscard: p.maxCardsPerDiscard,
        armor: p.armor,
        prediction: p.prediction,
        ...(idx === playerIndex ? { hand: p.hand } : {}),
      })),
    })
  })

  // Rematch functionality
  socket.on("requestRematch", ({ roomId }) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room || !player) return

    socket.to(roomId).emit("rematchRequested", { playerName: player.name })
    console.log(`🔄 ${player.name} requested rematch in room ${roomId}`)
  })

  socket.on("acceptRematch", ({ roomId }) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room || !player) return

    console.log(`✅ ${player.name} accepted rematch in room ${roomId}`)

    const deck = createDeck()
    const gameConfig = GAME_MODE_CONFIG[room.gameMode] || GAME_MODE_CONFIG[GAME_MODES.CLASSIC]

    room.players.forEach((player, index) => {
      player.health = gameConfig.startingHealth
      player.maxHealth = gameConfig.startingHealth
      player.hand = deck.slice(index * 8, (index + 1) * 8)
      player.selectedCards = []
      player.discardsUsed = 0
      player.maxDiscards = 3
      player.maxCardsPerDiscard = 3

      if (room.gameMode === GAME_MODES.TACTICAL) {
        player.armor = 0
        player.prediction = null
        player.parryCards = []
      }
    })

    room.gameState = "playing"
    room.currentPlayer = Math.floor(Math.random() * 2)
    console.log(`🎲 Rematch: ${room.players[room.currentPlayer].name} goes first!`)
    room.turn = 1
    room.deck = deck.slice(16)
    room.lastPlayedHand = null

    if (room.gameMode === GAME_MODES.RECYCLING) {
      room.discardPile = []
    }

    io.to(roomId).emit("rematchAccepted", {
      room: {
        ...room,
        gameMode: room.gameMode, // Ensure game mode is included
      },
    })
    console.log(`🎮 Rematch started in room ${roomId}`)
  })

  socket.on("declineRematch", ({ roomId }) => {
    const room = rooms.get(roomId)
    const player = players.get(socket.id)

    if (!room || !player) return

    console.log(`❌ ${player.name} declined rematch in room ${roomId}`)
    socket.to(roomId).emit("rematchDeclined")
  })

  socket.on("leaveRoom", () => {
    const player = players.get(socket.id)
    if (player && player.roomId) {
      const room = rooms.get(player.roomId)
      if (room) {
        room.players = room.players.filter((p) => p.id !== socket.id)
        socket.leave(player.roomId)

        if (room.players.length === 0) {
          rooms.delete(player.roomId)
        } else {
          io.to(player.roomId).emit("playerLeft", { playerId: socket.id })
        }

        player.roomId = null
        io.emit("roomsUpdated")
      }
    }
  })

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id)

    const player = players.get(socket.id)
    if (player && player.roomId) {
      const room = rooms.get(player.roomId)
      if (room) {
        room.players = room.players.filter((p) => p.id !== socket.id)

        if (room.players.length === 0) {
          rooms.delete(player.roomId)
        } else {
          io.to(player.roomId).emit("playerLeft", { playerId: socket.id })
        }

        io.emit("roomsUpdated")
      }
    }

    players.delete(socket.id)
  })
})

const PORT = process.env.PORT || 8080
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
