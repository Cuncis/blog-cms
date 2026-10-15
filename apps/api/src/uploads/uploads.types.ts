export type CoverUploadTicket = {
    uploadId: string;
    url: string; // POST the form here
    fields: Record<string, string>; // send every one of these, then the file as the LAST field, named "file"
    expiresInSeconds: number;
};

export type ConfirmedUpload = {
    id: string;
    contentType: string;
    size: number;
};

export type CleanupResult = { removed: number; skipped: number };