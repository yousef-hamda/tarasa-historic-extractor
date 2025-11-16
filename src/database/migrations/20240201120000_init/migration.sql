-- CreateTable
CREATE TABLE "PostRaw" (
    "id" SERIAL PRIMARY KEY,
    "groupId" TEXT NOT NULL,
    "fbPostId" TEXT NOT NULL UNIQUE,
    "authorName" TEXT,
    "authorLink" TEXT,
    "text" TEXT NOT NULL,
    "scrapedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- CreateTable
CREATE TABLE "PostClassified" (
    "id" SERIAL PRIMARY KEY,
    "postId" INTEGER NOT NULL UNIQUE,
    "isHistoric" BOOLEAN NOT NULL,
    "confidence" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "classifiedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "PostClassified_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageGenerated" (
    "id" SERIAL PRIMARY KEY,
    "postId" INTEGER NOT NULL,
    "messageText" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT "MessageGenerated_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MessageSent" (
    "id" SERIAL PRIMARY KEY,
    "postId" INTEGER NOT NULL,
    "authorLink" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "error" TEXT,
    CONSTRAINT "MessageSent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" SERIAL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
