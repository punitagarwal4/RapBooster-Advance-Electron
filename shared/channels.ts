/**
 * Channel name lists — deliberately free of any runtime dependency.
 *
 * WHY this is separate from ipc.ts: the preload runs with `sandbox: true`, where
 * `require` is limited to a small allowlist and cannot load zod from
 * node_modules. Importing the contract there would break the bridge entirely.
 * The preload needs only the names for its allowlist; validation is the router's
 * job in main.
 *
 * ipc.ts asserts at compile time that these lists exactly match the contract, so
 * adding a channel without adding its name here is a type error rather than a
 * runtime surprise.
 */

export const IPC_CHANNELS = [
  'license:status',
  'license:activate',
  'license:transfer',
  'license:deactivate',
  'license:revalidate',

  'device:list',
  'device:create',
  'device:rename',
  'device:connect',
  'device:requestPairingCode',
  'device:reconnect',
  'device:logout',
  'device:delete',

  'contactList:list',
  'contactList:create',
  'contactList:update',
  'contactList:delete',

  'contacts:list',
  'contacts:create',
  'contacts:update',
  'contacts:delete',
  'contacts:bulkDelete',
  'contacts:importPreview',
  'contacts:import',
  'contacts:export',

  'template:list',
  'template:create',
  'template:update',
  'template:delete',
  'template:usage',
  'template:preview',

  'campaign:list',
  'campaign:get',
  'campaign:create',
  'campaign:start',
  'campaign:pause',
  'campaign:resume',
  'campaign:stop',
  'campaign:delete',
  'campaign:recipients',
  'campaign:report',

  'group:list',
  'group:sync',
  'groupSend:create',
  'groupSend:status',
  'groupCreate:create',
  'groupCreate:status',

  'chat:list',
  'chat:get',
  'chat:messages',
  'chat:send',
  'chat:markRead',
  'chat:setOptOut',

  'chatbot:get',
  'chatbot:save',
  'chatbot:testKey',

  'settings:get',
  'settings:set',
  'settings:getSendingDefaults',
  'settings:setSendingDefaults',

  'system:dashboard',
  'system:version',
  'system:paths',
  'system:openPath',
  'system:exportDiagnostics',
  'system:backup',
  'system:restore',
  'system:clearData',
  'system:checkUpdate',
] as const

export const IPC_EVENTS = [
  'device:status',
  'device:qr',
  'device:pairingCode',
  'campaign:progress',
  'groupJob:progress',
  'message:received',
  'message:status',
  'license:changed',
  'wa:serviceState',
  'toast',
] as const

export type IpcChannelName = (typeof IPC_CHANNELS)[number]
export type IpcEventName = (typeof IPC_EVENTS)[number]
