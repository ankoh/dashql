visualize dashql.notebook."vis_data/random" as (
	mark => line,
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
)