# Analytics Specification

**Module:** Analytics
**Version:** 2.0
**Status:** Active
**Priority:** Must

## 1. Overview

Analytics module provides data visualization and insights through charts, heatmaps, and trends analysis.

## 2. Functional Requirements

### 2.1. Chart Endpoints

| ID | Description | Type |
|----|-------------|------|
| A-001 | Get category trends must return trends by category | Must |
| A-002 | Get daily heatmap must return daily spending data | Must |
| A-003 | Get distinct years must return available years | Must |
| A-004 | Get weekly data must return weekly totals | Must |
| A-005 | Get sankey must return flow data | Should |

### 2.2. Data Aggregation

| ID | Description | Type |
|----|-------------|------|
| A-010 | Analytics must aggregate by date (day, week, month) | Must |
| A-011 | Analytics must aggregate by category | Must |
| A-012 | Analytics must support period filtering | Must |
| A-013 | Analytics must support profile filtering | Must |

### 2.3. Data Sources

| ID | Description | Type |
|----|-------------|------|
| A-020 | Analytics must use transactions data | Must |
| A-021 | Analytics must support account filtering | Should |

### 2.4. Visualization

| ID | Description | Type |
|----|-------------|------|
| A-030 | Category trends must be line chart | Should |
| A-031 | Daily heatmap must be day-by-day grid | Should |
| A-032 | Weekly data must be bar chart | Should |
| A-033 | Sankey must show flow between categories | Could |

### 2.5. Performance

| ID | Description | Type |
|----|-------------|------|
| A-040 | Analytics calculations must complete within 500ms | Should |
| A-041 | Chart data must be cached where possible | Should |

## 3. Non-Functional Requirements

### 3.1. Performance

| ID | Description | Target |
|----|-------------|--------|
| NFR-001 | Get analytics must complete within 500ms | 500ms |
| NFR-002 | Large datasets must be paginated or grouped | Should |

### 3.2. Data Consistency

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-003 | Analytics must reflect current transaction data | Always |

### 3.3. Security

| ID | Description | Requirement |
|----|-------------|-------------|
| NFR-004 | Analytics must be scoped to user | Always |

## 4. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analytics/category-trends` | GET | Get category trends |
| `/api/analytics/daily-heatmap` | GET | Get daily spending heatmap |
| `/api/analytics/distinct-years` | GET | Get available years |
| `/api/analytics/weeks` | GET | Get weekly data |
| `/api/analytics/sankey` | GET | Get sankey flow data |

## 5. Data Models

**CategoryTrend:**
- `categoryName: string` - Category name
- `categoryColor: string` - Category color
- `data: TrendPoint[]` - Array of trend points

**TrendPoint:**
- `date: ISO8601` - Date
- `amount: number` - Amount

**DailyHeatmapEntry:**
- `date: ISO8601` - Date
- `amount: number` - Total amount
- `count: number` - Transaction count
- `category: string` - Primary category

**WeeklyData:**
- `weekStart: ISO8601` - Week start date
- `weekEnd: ISO8601` - Week end date
- `totalIncome: number` - Weekly total income
- `totalExpenses: number` - Weekly total expenses

**SankeyNode:**
- `name: string` - Node name
- `category: string` - Category
- `amount: number` - Amount

**SankeyLink:**
- `source: string` - Source node
- `target: string` - Target node
- `amount: number` - Amount

## 6. User Flows

### 6.1. View Category Trends

1. User opens Analytics page
2. System loads category trends
3. System displays line chart
4. System shows values on hover

### 6.2. View Daily Heatmap

1. User opens Analytics page
2. System loads heatmap data
3. System displays day-by-day grid
4. System highlights spending intensity

### 6.3. View Weekly Data

1. User opens Analytics page
2. System loads weekly data
3. System displays bar chart
4. System shows income vs expenses

### 6.4. Filter Analytics

1. User selects date range
2. User selects accounts
3. User selects profiles
4. System reloads analytics
5. System returns filtered data

## 7. Exceptional Conditions

| Condition | Behavior |
|-----------|----------|
| No data for period | Return empty array |
| Invalid date range | Return 400 with error message |
| User has no profiles | Return empty array |

## 8. Open/Closed Questions

1. Should analytics support custom date ranges?
2. Should analytics support export to CSV?
3. Should analytics include predictions?
4. Should analytics support multiple chart types per endpoint?

## 9. Acceptance Criteria

- [ ] User can view category trends
- [ ] User can view daily heatmap
- [ ] User can view weekly data
- [ ] Analytics are filtered by date range
- [ ] Analytics are scoped to user
- [ ] Charts display correctly
- [ ] Empty data is handled gracefully

## 10. Dependencies

| Data | Source |
|------|--------|
| Transactions | Transaction data |
| Categories | Category names and colors |
| Accounts | Account selection |
| Profiles | Profile selection |