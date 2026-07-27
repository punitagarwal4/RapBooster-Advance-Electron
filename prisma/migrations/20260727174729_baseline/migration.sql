-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "keyEncrypted" TEXT NOT NULL,
    "keyMasked" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "remarks" TEXT,
    "deviceFingerprint" TEXT NOT NULL,
    "deviceName" TEXT,
    "activatedAt" DATETIME,
    "expiresAt" DATETIME,
    "lastValidatedAt" DATETIME,
    "graceUntil" DATETIME,
    "serverPayload" TEXT,
    "signature" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "jid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "authFolder" TEXT NOT NULL,
    "lastActiveAt" DATETIME,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "dailySentCount" INTEGER NOT NULL DEFAULT 0,
    "dailyCountResetAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ContactList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "fields" TEXT NOT NULL,
    "contactCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contact_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ContactList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mediaType" TEXT,
    "mediaPath" TEXT,
    "options" TEXT,
    "buttons" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "templateId" TEXT NOT NULL,
    "scheduledAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "delayFrom" INTEGER NOT NULL DEFAULT 0,
    "delayTo" INTEGER NOT NULL DEFAULT 5,
    "sleepDuration" INTEGER NOT NULL DEFAULT 10,
    "sleepAfter" INTEGER NOT NULL DEFAULT 10,
    "retryAttempts" INTEGER NOT NULL DEFAULT 2,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignDevice" (
    "campaignId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,

    PRIMARY KEY ("campaignId", "deviceId"),
    CONSTRAINT "CampaignDevice_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignDevice_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignList" (
    "campaignId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,

    PRIMARY KEY ("campaignId", "listId"),
    CONSTRAINT "CampaignList_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ContactList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "messageId" TEXT,
    "error" TEXT,
    "claimedAt" DATETIME,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignRecipient_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Group_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupSendJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "delaySeconds" INTEGER NOT NULL DEFAULT 2,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "GroupSendJob_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupSendTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "sentAt" DATETIME,
    CONSTRAINT "GroupSendTarget_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GroupSendJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroupSendTarget_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GroupCreateJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "suffixRule" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "delaySeconds" INTEGER NOT NULL DEFAULT 2,
    "listIds" TEXT NOT NULL DEFAULT '[]',
    "contactsPerGroup" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "resultLog" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "GroupCreateJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Chat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" DATETIME,
    "lastMessage" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "isEscalated" BOOLEAN NOT NULL DEFAULT false,
    "autoReplyOptOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Chat_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "mediaPath" TEXT,
    "mediaType" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "buttons" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "isAiReply" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" DATETIME NOT NULL,
    CONSTRAINT "Message_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "Chat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatbotConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "systemInstructions" TEXT NOT NULL DEFAULT '',
    "businessName" TEXT,
    "businessEmail" TEXT,
    "businessPhone" TEXT,
    "responseDelay" INTEGER NOT NULL DEFAULT 2,
    "tone" TEXT NOT NULL DEFAULT 'professional',
    "industry" TEXT,
    "primaryGoal" TEXT NOT NULL DEFAULT 'support',
    "responseStyle" TEXT NOT NULL DEFAULT 'conversational',
    "language" TEXT NOT NULL DEFAULT 'english',
    "escalationTrigger" TEXT NOT NULL DEFAULT 'keywords',
    "escalationKeywords" TEXT NOT NULL DEFAULT '[]',
    "escalationMessage" TEXT,
    "confidenceThreshold" INTEGER NOT NULL DEFAULT 75,
    "products" TEXT NOT NULL DEFAULT '',
    "knowledgeBase" TEXT NOT NULL DEFAULT '',
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "isEncrypted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Device_status_idx" ON "Device"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ContactList_name_key" ON "ContactList"("name");

-- CreateIndex
CREATE INDEX "Contact_listId_name_idx" ON "Contact"("listId", "name");

-- CreateIndex
CREATE INDEX "Contact_phone_idx" ON "Contact"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_listId_phone_key" ON "Contact"("listId", "phone");

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "CampaignDevice_deviceId_idx" ON "CampaignDevice"("deviceId");

-- CreateIndex
CREATE INDEX "CampaignList_listId_idx" ON "CampaignList"("listId");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_deviceId_status_idx" ON "CampaignRecipient"("deviceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient"("campaignId", "contactId");

-- CreateIndex
CREATE INDEX "Group_deviceId_idx" ON "Group"("deviceId");

-- CreateIndex
CREATE INDEX "GroupSendJob_status_idx" ON "GroupSendJob"("status");

-- CreateIndex
CREATE INDEX "GroupSendTarget_jobId_status_idx" ON "GroupSendTarget"("jobId", "status");

-- CreateIndex
CREATE INDEX "GroupSendTarget_groupId_idx" ON "GroupSendTarget"("groupId");

-- CreateIndex
CREATE INDEX "GroupCreateJob_deviceId_idx" ON "GroupCreateJob"("deviceId");

-- CreateIndex
CREATE INDEX "GroupCreateJob_status_idx" ON "GroupCreateJob"("status");

-- CreateIndex
CREATE INDEX "Chat_deviceId_lastMessageAt_idx" ON "Chat"("deviceId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Message_chatId_timestamp_idx" ON "Message"("chatId", "timestamp");
