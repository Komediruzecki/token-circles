#!/bin/bash

# Replace kebab-case selectors with camelCase for CSS modules
sed -i "s/\.page-header/.pageHeader/g" tests/*.spec.ts
sed -i "s/\.page-subtitle/.pageSubtitle/g" tests/*.spec.ts
sed -i "s/\.page-header-actions/.pageHeaderActions/g" tests/*.spec.ts
sed -i "s/\.page-accounts/.pageAccounts/g" tests/*.spec.ts
sed -i "s/\.accounts-summary/.accountsSummary/g" tests/*.spec.ts
sed -i "s/\.summary-card/.summaryCard/g" tests/*.spec.ts
sed -i "s/\.summary-value/.summaryValue/g" tests/*.spec.ts
sed -i "s/\.accounts-grid/.accountsGrid/g" tests/*.spec.ts
sed -i "s/\.account-card/.accountCard/g" tests/*.spec.ts
sed -i "s/\.account-icon/.accountIcon/g" tests/*.spec.ts
sed -i "s/\.account-name/.accountName/g" tests/*.spec.ts
sed -i "s/\.account-bank/.accountBank/g" tests/*.spec.ts
sed -i "s/\.account-balance/.accountBalance/g" tests/*.spec.ts
sed -i "s/\.balance-label/.balanceLabel/g" tests/*.spec.ts
sed -i "s/\.balance-amount/.balanceAmount/g" tests/*.spec.ts
sed -i "s/\.account-activity/.accountActivity/g" tests/*.spec.ts
sed -i "s/\.activity-header/.activityHeader/g" tests/*.spec.ts
sed -i "s/\.activity-header a/.activityHeader a/g" tests/*.spec.ts
sed -i "s/\.activity-list/.activityList/g" tests/*.spec.ts
sed -i "s/\.activity-item/.activityItem/g" tests/*.spec.ts
sed -i "s/\.activity-content/.activityContent/g" tests/*.spec.ts
sed -i "s/\.activity-desc/.activityDesc/g" tests/*.spec.ts
sed -i "s/\.activity-date/.activityDate/g" tests/*.spec.ts
sed -i "s/\.activity-amount/.activityAmount/g" tests/*.spec.ts
sed -i "s/\.activity-amount\.expense/.activityAmount.expense/g" tests/*.spec.ts
sed -i "s/\.activity-amount\.income/.activityAmount.income/g" tests/*.spec.ts
sed -i "s/\.account-actions/.accountActions/g" tests/*.spec.ts
sed -i "s/\.account-actions button:has-text("Delete")/.accountActions button:has-text("Delete")/g" tests/*.spec.ts
sed -i "s/\.modal-overlay/.modalOverlay/g" tests/*.spec.ts
sed -i "s/\.modal-close/.modalClose/g" tests/*.spec.ts
sed -i "s/\.modal-title/.modalTitle/g" tests/*.spec.ts
sed -i "s/\.modal-body/.modalBody/g" tests/*.spec.ts
sed -i "s/\.modal-footer/.modalFooter/g" tests/*.spec.ts
sed -i "s/\.modal-header/.modalHeader/g" tests/*.spec.ts
sed -i "s/\.form-group/.formGroup/g" tests/*.spec.ts
sed -i "s/\.form-label/.formLabel/g" tests/*.spec.ts
sed -i "s/\.form-control/.formControl/g" tests/*.spec.ts
sed -i "s/\.empty-state/.emptyState/g" tests/*.spec.ts

echo "Selectors fixed!"
