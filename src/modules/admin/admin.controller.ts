import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { ReviewPharmacyDto } from './dto/review-pharmacy.dto';
import { SoftDeleteUserDto } from './dto/soft-delete-user.dto';
import { ListPharmaciesQueryDto } from './dto/list-pharmacies-query.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ListReservationsQueryDto } from './dto/list-reservations-query.dto';
import { ActivityQueryDto } from './dto/activity-query.dto';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/types/auth-user.type';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get('pharmacies')
  @ApiOperation({ summary: 'List all pharmacies (filter by status)' })
  listPharmacies(@Query() query: ListPharmaciesQueryDto) {
    return this.adminService.listPharmacies(query);
  }

  @Post('pharmacies/:id/approve')
  @ApiOperation({ summary: 'Approve a pharmacy registration' })
  approvePharmacy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthUser,
  ) {
    return this.adminService.approvePharmacy(id, admin.id);
  }

  @Post('pharmacies/:id/reject')
  @ApiOperation({ summary: 'Reject a pharmacy registration' })
  rejectPharmacy(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthUser,
    @Body() dto: ReviewPharmacyDto,
  ) {
    return this.adminService.rejectPharmacy(id, admin.id, dto.rejection_reason);
  }

  @Get('users')
  @ApiOperation({ summary: 'List all users with cursor pagination' })
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Soft delete a user' })
  softDeleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SoftDeleteUserDto,
  ) {
    void dto;
    return this.adminService.softDeleteUser(id);
  }

  @Get('reservations')
  @ApiOperation({
    summary: 'List all reservations (filter by status, date range)',
  })
  listAllReservations(@Query() query: ListReservationsQueryDto) {
    return this.adminService.listAllReservations(query);
  }

  @Get('analytics/overview')
  @ApiOperation({ summary: 'System KPIs overview' })
  getAnalyticsOverview() {
    return this.adminService.getAnalyticsOverview();
  }

  @Get('activity-feed')
  @ApiOperation({ summary: 'Recent admin activity feed' })
  getActivityFeed(@Query() query: ActivityQueryDto) {
    return this.adminService.getActivityFeed(query);
  }

  @Get('analytics/drugs/searched')
  @ApiOperation({ summary: 'Top searched drugs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getTopSearchedDrugs(@Query('limit') limit?: number) {
    return this.adminService.getTopSearchedDrugs(limit ? Number(limit) : 10);
  }

  @Get('analytics/drugs/purchased')
  @ApiOperation({ summary: 'Top purchased drugs' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getTopPurchasedDrugs(@Query('limit') limit?: number) {
    return this.adminService.getTopPurchasedDrugs(limit ? Number(limit) : 10);
  }
}
