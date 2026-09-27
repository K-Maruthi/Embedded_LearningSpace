/* The Compilation Path lab example, compiled live by the real toolchain.
   Same program the static teaching view shows, with the includes a real
   compilation needs. */
#include <stdint.h>

#define LIMIT 10

static uint32_t counter = 3;

uint32_t add_limit(uint32_t x)
{
    return x + LIMIT;
}

int main(void)
{
    uint32_t y = add_limit(counter);
    return (int)y;
}
