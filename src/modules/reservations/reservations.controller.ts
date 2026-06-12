import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { ConfirmPickupDto } from './dto/confirm-pickup.dto';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationsService } from './reservations.service';

@ApiTags('Reservations')
@ApiBearerAuth()
@Controller()
@UseGuards(SupabaseAuthGuard, RolesGuard)
export class ReservationsController {
  constructor(private reservationsService: ReservationsService) {}

  @Post('reservations')
  @Roles('user')
  @ApiOperation({ summary: 'Create a new medicine reservation' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReservationDto) {
    return this.reservationsService.create(user.id, dto);
  }

  @Get('reservations/me')
  @Roles('user')
  @ApiOperation({ summary: 'List current user reservations' })
  listMine(@CurrentUser() user: AuthUser) {
    return this.reservationsService.listMine(user.id);
  }

  @Delete('reservations/:id')
  @Roles('user')
  @ApiOperation({ summary: 'Cancel a pending reservation' })
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reservationsService.cancel(id, user.id);
  }

  @Get('pharmacy/reservations')
  @Roles('pharmacy')
  @ApiOperation({ summary: 'List reservations received by current pharmacy' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'confirmed', 'cancelled', 'expired'],
  })
  listForPharmacy(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
  ) {
    return this.reservationsService.listForPharmacy(user.id, status);
  }

  @Delete('pharmacy/reservations/:id')
  @Roles('pharmacy')
  @ApiOperation({
    summary: 'Cancel a pending reservation for current pharmacy',
  })
  cancelForPharmacy(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reservationsService.cancelForPharmacy(id, user.id);
  }

  @Post('pharmacy/pickup')
  @Roles('pharmacy')
  @ApiOperation({ summary: 'Confirm pickup using reservation short code' })
  confirmPickup(@CurrentUser() user: AuthUser, @Body() dto: ConfirmPickupDto) {
    return this.reservationsService.confirmPickup(dto.shortCode, user.id);
  }
}
