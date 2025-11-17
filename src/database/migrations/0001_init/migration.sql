-- CreateTable
CREATE TABLE "PostRaw" (
    "id" SERIAL NOT NULL,
    "groupId" TEXT NOT NULL,
    "fbPostId" TEXT NOT NULL,
    "authorName" TEXT,
    "authorLink" TEXT,
    "text" TEXT NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostClassified" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "isHistoric" BOOLEAN NOT NULL,
    "confidence" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "classifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostClassified_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageGenerated" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "messageText" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageGenerated_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageSent" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "authorLink" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "MessageSent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostRaw_fbPostId_key" ON "PostRaw"("fbPostId");

-- CreateIndex
CREATE UNIQUE INDEX "PostClassified_postId_key" ON "PostClassified"("postId");

-- AddForeignKey
ALTER TABLE "PostClassified" ADD CONSTRAINT "PostClassified_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageGenerated" ADD CONSTRAINT "MessageGenerated_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageSent" ADD CONSTRAINT "MessageSent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "PostRaw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

