import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { AuthUser, JwtPayload } from "@/contracts";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(config: ConfigService) {
    const secret = config.get<string>("JWT_SECRET");
    if (!secret) {
      throw new Error("JWT_SECRET is not set in environment");
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  validate(payload: JwtPayload): AuthUser {
    return {
      id: payload.sub,
      role: payload.role,
      companyId: payload.companyId,
      branchId: payload.branchId,
    };
  }
}
