import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AccessGuard } from "./access.guard";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";

@Global()
@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const expiresIn = (config.get<string>("JWT_EXPIRES_IN") ?? "1h") as `${number}${"s" | "m" | "h" | "d"}`;
        return {
          secret: config.get<string>("JWT_SECRET"),
          signOptions: { expiresIn },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, AccessGuard],
  exports: [AuthService, AccessGuard, JwtModule],
})
export class AuthModule {}
