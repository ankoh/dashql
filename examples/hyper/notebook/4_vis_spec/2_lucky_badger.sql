visualize dashql.notebook."vis_data/random" as (
    mark => (
        type => line,
        point => (
            filled => false,
            fill => 'white'
        )
    ),
    encoding => (
        x => (
            field => x,
            type => quantitative
        ),
        y => (
            field => y,
            type => quantitative
        )
    )
);