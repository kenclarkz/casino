// Shared wire constants. Every message between clients and the authority is a
// plain JSON object; `t` is the message type.

export const PHASES = {
  LOBBY: 'lobby',
  PICKING: 'picking',
  OPENING: 'opening',
  OFFER: 'offer',
  TWIST: 'twist',
  GAMEOVER: 'gameover',
}

export const A = {
  HELLO: 'hello',        // {role} first message on a new connection
  JOIN: 'join',          // {name, avatar}
  START: 'start',        // tv only
  PICK_CASE: 'pickCase', // {caseId} claim your own case
  OPEN_CASE: 'openCase', // {caseId} open someone else's case on your turn
  DEAL: 'deal',
  NO_DEAL: 'noDeal',
  TWIST_CHOICE: 'twist', // {swap:boolean}
  ADD_BOT: 'addBot',     // tv only: seat a house robot
  KICK: 'kick',          // tv only: {playerId} unseat a bot (lobby only)
  RESTART: 'restart',    // tv only
}

export const E = {
  JOINED: 'joined',
  LEFT: 'left',
  STARTED: 'started',
  CASE_PICKED: 'casePicked',
  CASE_OPENED: 'caseOpened',
  TURN: 'turn',
  BANKER_CALLING: 'bankerCalling',
  OFFER_OPEN: 'offerOpen',
  ANSWERED: 'answered',
  DEALT: 'dealt',
  STOOD: 'stood',
  OFFER_RESOLVED: 'offerResolved',
  TWIST_INCOMING: 'twistIncoming',
  TWIST_TAKEN: 'twistTaken',
  ALL_CASHED: 'allCashed',
  FINISHED: 'finished',
}

// Timing (ms). The authority stamps absolute deadlines into state; tests pass
// virtual time to tick().
export const TIMINGS = {
  PICK_MS: 45000,
  TURN_MS: 30000,
  OFFER_MS: 20000,
  TWIST_MS: 15000,
}
