/*
  Warnings:

  - A unique constraint covering the columns `[coverImageId]` on the table `posts` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE `posts` ADD COLUMN `coverImageId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `uploads` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `contentType` VARCHAR(50) NOT NULL,
    `size` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'CONFIRMED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmedAt` DATETIME(3) NULL,

    INDEX `uploads_status_createdAt_idx`(`status`, `createdAt`),
    INDEX `uploads_userId_status_createdAt_idx`(`userId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `posts_coverImageId_key` ON `posts`(`coverImageId`);

-- AddForeignKey
ALTER TABLE `uploads` ADD CONSTRAINT `uploads_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `posts` ADD CONSTRAINT `posts_coverImageId_fkey` FOREIGN KEY (`coverImageId`) REFERENCES `uploads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
