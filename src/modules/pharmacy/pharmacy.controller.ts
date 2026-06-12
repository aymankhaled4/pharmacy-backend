import { Controller, Get, Post, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PharmacyService } from './pharmacy.service';
import { RegisterPharmacyDto } from './dto/register-pharmacy.dto';
import { UpdatePharmacyProfileDto } from './dto/update-pharmacy-profile.dto';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

@ApiTags('Pharmacy')
@Controller('pharmacy')
export class PharmacyController {
  constructor(private pharmacyService: PharmacyService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new pharmacy (public)' })
  register(@Body() dto: RegisterPharmacyDto) {
    return this.pharmacyService.register(dto);
  }

  @Get('me')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current pharmacy profile and status' })
  getProfile(@CurrentUser() user: AuthUser) {
    return this.pharmacyService.getProfile(user.id);
  }

  @Patch('me')
  @UseGuards(SupabaseAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update pharmacy profile' })
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdatePharmacyProfileDto,
  ) {
    return this.pharmacyService.updateProfile(user.id, dto);
  }
}
