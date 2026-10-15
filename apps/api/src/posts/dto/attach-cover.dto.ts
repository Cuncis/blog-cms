import { IsUUID } from 'class-validator';

export class AttachCoverDto {
    @IsUUID()
    uploadId!: string;
}