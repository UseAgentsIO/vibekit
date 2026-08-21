export { createTelegramInterface, TelegramInterface } from "./telegram.js";
export { createDefaultTelegramTransport, asUpdate } from "./transport.js";
export type {
  TelegramCallbackQuery,
  TelegramChat,
  TelegramEventHandlers,
  TelegramMessage,
  TelegramTransport,
  TelegramTransportOptions,
  TelegramUpdate,
  TelegramUser,
} from "./transport.js";
export {
  PAIRING_CODE_LENGTH,
  PAIRING_STORE_RELATIVE,
  PAIRING_TTL_MS,
  approvePairing,
  generatePairingCode,
  issuePairingCode,
  isTrustedSender,
  list,
  listPairings,
  pairingStorePath,
  readPairingStore,
  revoke,
  revokePairing,
} from "./pairing.js";
export type {
  PairedSender,
  PairingDocument,
  PairingList,
  PendingPairing,
} from "./pairing.js";
