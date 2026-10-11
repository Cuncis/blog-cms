import {
    Body,
    Controller,
    Get,
    Header,
    HttpCode,
    HttpStatus,
    Post,
    Req,
    Res,
    UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { LOGIN_LIMIT, REFRESH_LIMIT, REGISTER_LIMIT } from '../rate-limit/rate-limit.config.js';
import type { PublicUser } from '../users/users.types.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedUser, LoginResult } from './auth.types.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { RefreshCookieService } from './refresh-cookie.service.js';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly refreshCookie: RefreshCookieService,
    ) { }

    @Public()
    @Post('register')
    @Throttle({ default: REGISTER_LIMIT })
    register(@Body() dto: RegisterDto): Promise<PublicUser> {
        return this.authService.register(dto); // 201 Created
    }

    @Public()
    @Post('login')
    @HttpCode(HttpStatus.OK) // login creates nothing, so 200 rather than 201
    @Header('Cache-Control', 'no-store') // responses carrying tokens must never be cached
    @Throttle({ default: LOGIN_LIMIT })
    async login(
        @Body() dto: LoginDto,
        @Res({ passthrough: true }) res: Response,
    ): Promise<LoginResult> {
        const { refreshToken, result } = await this.authService.login(dto);

        this.refreshCookie.set(res, refreshToken);
        return result; // the refresh token travels only in the cookie
    }

    // Public because it is authenticated by the refresh cookie, not by an access token
    @Public()
    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @Header('Cache-Control', 'no-store')
    @Throttle({ default: REFRESH_LIMIT })
    async refresh(
        @Req() req: Request,
        @Res({ passthrough: true }) res: Response,
    ): Promise<LoginResult> {
        try {
            const { refreshToken, result } = await this.authService.refresh(this.refreshCookie.read(req));

            this.refreshCookie.set(res, refreshToken);
            return result;
        } catch (error) {
            // A rejected token is useless: tell the browser to stop sending it.
            // Other errors (e.g. database down) keep the cookie so the user isn't logged out for nothing.
            if (error instanceof UnauthorizedException) {
                this.refreshCookie.clear(res);
            }
            throw error;
        }
    }

    // Public so it still works after the access token has expired. It is driven by the cookie.
    @Public()
    @Post('logout')
    @HttpCode(HttpStatus.NO_CONTENT)
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
        await this.authService.logout(this.refreshCookie.read(req));

        // Cleared only AFTER the session was revoked: if revocation failed, the cookie stays
        // so the client can retry instead of believing it is logged out while it is not
        this.refreshCookie.clear(res);
    }

    // Protected: ending every session needs proof of a live one
    @Post('logout-all')
    @HttpCode(HttpStatus.NO_CONTENT)
    async logoutAll(
        @CurrentUser() user: AuthenticatedUser,
        @Res({ passthrough: true }) res: Response,
    ): Promise<void> {
        await this.authService.logoutAll(user.id);
        this.refreshCookie.clear(res);
    }

    @Get('me')
    @Header('Cache-Control', 'no-store')
    me(@CurrentUser() user: AuthenticatedUser): Promise<PublicUser> {
        return this.authService.getProfile(user.id); // read fresh from the database, role included
    }
}