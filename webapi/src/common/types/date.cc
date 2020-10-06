// Copyright (c) 2020 The DashQL Authors

#include "duckdb_webapi/common/exception.h"
#include "duckdb_webapi/common/types/date.h"
#include <sstream>

namespace duckdb_webapi {

namespace {

static int NORMALDAYS[13] = {0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
static int LEAPDAYS[13] = {0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
static int CUMDAYS[13] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334, 365};
static int CUMLEAPDAYS[13] = {0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335, 366};

#define YEAR_MAX 5867411
#define YEAR_MIN (-YEAR_MAX)
#define MONTHDAYS(m, y) ((m) != 2 ? LEAPDAYS[m] : leapyear(y) ? 29 : 28)
#define YEARDAYS(y) (leapyear(y) ? 366 : 365)
#define DD_DATE(d, m, y)                                                                                               \
    ((m) > 0 && (m) <= 12 && (d) > 0 && (y) != 0 && (y) >= YEAR_MIN && (y) <= YEAR_MAX && (d) <= MONTHDAYS(m, y))
#define LOWER(c) ((c) >= 'A' && (c) <= 'Z' ? (c) + 'a' - 'A' : (c))
// 1970-01-01 in date_t format
#define EPOCH_DATE 719528
// 1970-01-01 was a Thursday
#define EPOCH_DAY_OF_THE_WEEK 4
#define SECONDS_PER_DAY (60 * 60 * 24)

#define leapyear(y) ((y) % 4 == 0 && ((y) % 100 != 0 || (y) % 400 == 0))

int leapyears(int year) {
    /* count the 4-fold years that passed since jan-1-0 */
    int y4 = year / 4;

    /* count the 100-fold years */
    int y100 = year / 100;

    /* count the 400-fold years */
    int y400 = year / 400;

    return y4 + y400 - y100 + (year >= 0); /* may be negative */
}

}

std::tuple<int32_t, int32_t, int32_t> Date::toDate(int32_t n) {
    int32_t year = n / 365;
    int32_t month = 0;
    int32_t day = (n - year * 365) - leapyears(year >= 0 ? year - 1 : year);
    if (n < 0) {
        year--;
        while (day >= 0) {
            year++;
            day -= YEARDAYS(year);
        }
        day = YEARDAYS(year) + day;
    } else {
        while (day < 0) {
            year--;
            day += YEARDAYS(year);
        }
    }

    day++;
    if (leapyear(year)) {
        for (month = day / 31 == 0 ? 1 : day / 31; month <= 12; month++)
            if (day > CUMLEAPDAYS[month - 1] && day <= CUMLEAPDAYS[month]) {
                break;
            }
        day -= CUMLEAPDAYS[month - 1];
    } else {
        for (month = day / 31 == 0 ? 1 : day / 31; month <= 12; month++)
            if (day > CUMDAYS[month - 1] && day <= CUMDAYS[month]) {
                break;
            }
        day -= CUMDAYS[month - 1];
    }
    year = (year <= 0) ? year - 1 : year;
    return {year, month, day};
}

date_t Date::fromDate(int32_t year, int32_t month, int32_t day) {
    int32_t n = 0;
    if (!(DD_DATE(day, month, year))) {
        throw ConversionException(emsg() << "Date out of range: " << year << "-" << month << "-" << day);
    }

    if (year < 0)
        year++;
    n = (int32_t)(day - 1);
    if (month > 2 && leapyear(year)) {
        n++;
    }
    n += CUMDAYS[month - 1];
    /* current year does not count as leapyear */
    n += 365 * year + leapyears(year >= 0 ? year - 1 : year);

    return n;
}


}
